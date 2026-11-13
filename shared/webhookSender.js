const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { createLogger } = require('./logger');
const { webhooksCounter } = require('./metrics');

const log = createLogger('webhooks-sender');

function computeHmacSignature(secret, timestamp, rawBody) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

async function deliverSignedWebhook({ endpointId, envMode, eventType, targetUrl, secret, payload, existingDeliveryId = null }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(payload);
  const signingSecret = secret || config.webhooks.defaultSecret;
  const signatureHeader = computeHmacSignature(signingSecret, timestamp, rawBody);

  const start = Date.now();
  let httpStatus = null;
  let responseBody = '';
  let deliveryStatus = 'failed';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhooks.timeoutMs);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PayOps-Webhook-Dispatcher/1.1',
        'X-PayOps-Event': eventType,
        'X-PayOps-Signature': signatureHeader,
        'X-PayOps-Timestamp': String(timestamp)
      },
      body: rawBody,
      signal: controller.signal
    });
    clearTimeout(timer);

    httpStatus = res.status;
    responseBody = (await res.text()).slice(0, 1000);
    deliveryStatus = res.ok ? 'delivered' : 'failed';
  } catch (err) {
    responseBody = `Network/Timeout Error: ${err.message}`;
    deliveryStatus = 'failed';
  }

  const durationMs = Date.now() - start;
  webhooksCounter.inc({ status: deliveryStatus, event_type: eventType });

  if (existingDeliveryId) {
    const updated = await db.query(
      `UPDATE webhook_deliveries
       SET signature_header = $1,
           http_status = $2,
           response_body = $3,
           duration_ms = $4,
           attempt_count = attempt_count + 1,
           delivery_status = $5,
           last_attempt_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [signatureHeader, httpStatus, responseBody, durationMs, deliveryStatus, existingDeliveryId]
    );
    log.info('Replayed webhook delivery', {
      deliveryId: existingDeliveryId,
      eventType,
      targetUrl,
      httpStatus,
      deliveryStatus,
      durationMs
    });
    return updated.rows[0];
  }

  const inserted = await db.query(
    `INSERT INTO webhook_deliveries
      (endpoint_id, env_mode, event_type, target_url, payload, signature_header, http_status, response_body, duration_ms, attempt_count, delivery_status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 1, $10)
     RETURNING *`,
    [endpointId, envMode, eventType, targetUrl, rawBody, signatureHeader, httpStatus, responseBody, durationMs, deliveryStatus]
  );

  log.info('Processed signed webhook delivery', {
    deliveryId: inserted.rows[0].id,
    eventType,
    targetUrl,
    httpStatus,
    deliveryStatus,
    durationMs
  });

  return inserted.rows[0];
}

module.exports = { computeHmacSignature, deliverSignedWebhook };
