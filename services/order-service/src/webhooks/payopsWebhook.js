const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

const FIVE_MINUTES_SEC = 5 * 60;

/**
 * Rule 5: Verify signature on RAW body before JSON parsing.
 * signing_input = `${X-PayOps-Timestamp}.${rawBody}`
 * Compare hex HMAC-SHA256 against v1= in X-PayOps-Signature ("t=<timestamp>,v1=<hex>") using timingSafeEqual.
 * Reject timestamps older than 5 minutes.
 */
function verifyPayOpsSignature({ rawBody, timestampHeader, signatureHeader, secret = config.PAYOPS_WEBHOOK_SECRET, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!rawBody || !timestampHeader || !signatureHeader || !secret) {
    return { valid: false, reason: 'missing_signature_headers_or_body' };
  }

  const tsNum = parseInt(String(timestampHeader), 10);
  if (Number.isNaN(tsNum)) {
    return { valid: false, reason: 'invalid_timestamp' };
  }

  // Reject timestamps older than 5 minutes (and unreasonable future skew > 5 min)
  if (nowSec - tsNum > FIVE_MINUTES_SEC || tsNum - nowSec > FIVE_MINUTES_SEC) {
    return { valid: false, reason: 'timestamp_expired' };
  }

  const parts = String(signatureHeader).split(',');
  const v1Part = parts.find((p) => p.trim().startsWith('v1='));
  if (!v1Part) {
    return { valid: false, reason: 'missing_v1_signature' };
  }
  const suppliedV1 = v1Part.trim().slice(3);

  const signingInput = `${timestampHeader}.${rawBody}`;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const suppliedBuf = Buffer.from(suppliedV1, 'utf8');

  if (expectedBuf.length !== suppliedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  const isMatch = crypto.timingSafeEqual(expectedBuf, suppliedBuf);
  return isMatch ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}

/**
 * Process verified webhook asynchronously after sending HTTP 200.
 */
async function processWebhookEvent(db, { deliveryId, eventType, payload }) {
  // Idempotency: store X-PayOps-Delivery-Id in processed_webhook_events and ignore duplicates
  const insertRes = await db.query(
    `INSERT INTO processed_webhook_events (delivery_id, event_type, intent_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (delivery_id) DO NOTHING
     RETURNING delivery_id`,
    [deliveryId, eventType, payload?.data?.intent_id || null]
  );

  if (insertRes.rowCount === 0) {
    logger.info('Duplicate webhook ignored', { delivery_id: deliveryId, event_type: eventType });
    return { duplicate: true };
  }

  const intentId = payload?.data?.intent_id;
  if (!intentId) {
    logger.warn('Webhook missing data.intent_id', { delivery_id: deliveryId, event_type: eventType });
    return { processed: false, reason: 'missing_intent_id' };
  }

  // Lookup order by orders.payment_intent_id
  const orderRes = await db.query('SELECT * FROM orders WHERE payment_intent_id = $1', [intentId]);
  if (orderRes.rowCount === 0) {
    // Rule 5: If order is not found, return 2xx and let reconciliation job fix it
    logger.warn('Order not found for webhook intent_id; deferring to reconciliation', {
      delivery_id: deliveryId,
      intent_id: intentId,
    });
    return { processed: false, reason: 'order_not_found' };
  }

  const order = orderRes.rows[0];
  let nextStatus = null;
  if (eventType === 'payment.succeeded') {
    nextStatus = 'PAID';
  } else if (eventType === 'payment.failed') {
    nextStatus = 'PAYMENT_FAILED';
  } else if (eventType === 'refund.succeeded') {
    nextStatus = 'CANCELLED';
  }

  if (nextStatus && order.status !== nextStatus) {
    // Do not downgrade an already PAID/SHIPPED/DELIVERED order to PAYMENT_FAILED
    if (nextStatus === 'PAYMENT_FAILED' && ['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      logger.info('Ignoring late payment.failed webhook for already paid order', { order_id: order.id });
      return { processed: true, ignoredTransition: true };
    }

    await db.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [nextStatus, order.id]
    );
    logger.info('Order status updated via PayOps webhook', {
      order_id: order.id,
      intent_id: intentId,
      event_type: eventType,
      new_status: nextStatus,
    });
  }

  return { processed: true, orderId: order.id, newStatus: nextStatus };
}

function createWebhookRouter({ db }) {
  const express = require('express');
  const router = express.Router();

  // Capture raw body BEFORE JSON parsing
  router.post(
    '/payments',
    express.raw({ type: 'application/json' }),
    (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
      const timestampHeader = req.headers['x-payops-timestamp'];
      const signatureHeader = req.headers['x-payops-signature'];
      const deliveryId = req.headers['x-payops-delivery-id'];
      const eventTypeHeader = req.headers['x-payops-event'];

      const verification = verifyPayOpsSignature({
        rawBody,
        timestampHeader,
        signatureHeader,
      });

      if (!verification.valid) {
        logger.warn('Rejected invalid PayOps webhook', {
          reason: verification.reason,
          delivery_id: deliveryId,
        });
        return res.status(401).json({ error: { code: 'invalid_signature', message: verification.reason } });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
      }

      const resolvedDeliveryId = deliveryId || payload.id;
      const resolvedEventType = eventTypeHeader || payload.event_type;

      if (!resolvedDeliveryId || !resolvedEventType) {
        return res.status(400).json({ error: { code: 'missing_metadata', message: 'Missing delivery ID or event type' } });
      }

      // Rule 5: Respond 200 quickly (PayOps timeout is 5 seconds); do the update after responding
      res.status(200).json({ received: true, delivery_id: resolvedDeliveryId });

      setImmediate(() => {
        processWebhookEvent(db, {
          deliveryId: resolvedDeliveryId,
          eventType: resolvedEventType,
          payload,
        }).catch((err) => {
          logger.error('Async webhook processing error', { error: err.message, delivery_id: resolvedDeliveryId });
        });
      });
    }
  );

  return router;
}

module.exports = {
  verifyPayOpsSignature,
  processWebhookEvent,
  createWebhookRouter,
};
