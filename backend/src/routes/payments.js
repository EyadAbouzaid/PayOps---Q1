const crypto = require('crypto');
const express = require('express');
const db = require('../shared/db');
const { authenticateApiKey, requirePermission } = require('../middleware/authRbac');
const { idempotencyMiddleware } = require('../middleware/idempotency');
const vaultClient = require('../core/vaultClient');
const stateMachine = require('../core/paymentStateMachine');
const routingEngine = require('../core/routingEngine');
const { getConnectorAdapter, getConnectorCredentials } = require('../core/connectorAdapter');
const { enqueueWebhookEvent, enqueueInvoiceGeneration } = require('../queue/jobQueue');
const { paymentIntentsTotal, routingFailoversTotal, renderMetrics } = require('../observability/metrics');

const router = express.Router();

router.get('/health', async (req, res) => {
  res.json({ service: 'payments-module', status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/metrics', renderMetrics);

router.use(authenticateApiKey);

router.post('/tokenize', requirePermission('payments', 'write'), async (req, res, next) => {
  try {
    const tokenRecord = await vaultClient.tokenize({
      merchantId: req.merchantId,
      envMode: req.envMode,
      card: req.body?.card,
    });
    res.status(201).json({ object: 'vault_token', ...tokenRecord });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const {
        amount_cents,
        currency = 'USD',
        capture_method = 'automatic',
        confirm = true,
        customer_email = null,
        description = null,
        metadata = {},
        card = null,
        vault_token = null,
        auto_invoice = true,
      } = req.body || {};

      const parsedAmount = Number(amount_cents);
      if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          error: { code: 'invalid_amount', message: '`amount_cents` must be a positive integer.' },
        });
      }

      const intent = await stateMachine.createIntent({
        merchantId: req.merchantId,
        envMode: req.envMode,
        amountCents: parsedAmount,
        currency,
        captureMethod: capture_method === 'manual' ? 'manual' : 'automatic',
        customerEmail: customer_email,
        description,
        metadata,
        idempotencyKey: req.idempotencyKey || null,
        initialStatus: card || vault_token ? 'requires_confirmation' : 'requires_payment_method',
      });

      if (!confirm || (!card && !vault_token)) {
        return res.status(201).json({ intent, attempts: [] });
      }

      const execution = await routingEngine.executeRoutedPayment({
        intent,
        card,
        vaultToken: vault_token,
      });

      const finalConnector = execution.active_attempt?.connector || 'none';
      paymentIntentsTotal.labels(req.envMode, execution.intent.status, finalConnector).inc();

      if (execution.routing_summary.failover_triggered && execution.attempts.length >= 2) {
        routingFailoversTotal
          .labels(req.envMode, execution.attempts[0].connector, finalConnector)
          .inc();
      }

      const eventType =
        execution.intent.status === 'succeeded' || execution.intent.status === 'requires_capture'
          ? 'payment.succeeded'
          : 'payment.failed';

      await enqueueWebhookEvent({
        merchantId: req.merchantId,
        envMode: req.envMode,
        eventType,
        payload: {
          intent_id: execution.intent.id,
          amount_cents: Number(execution.intent.amount_cents),
          currency: execution.intent.currency,
          status: execution.intent.status,
          connector: finalConnector,
          attempt_count: execution.attempts.length,
          failover_triggered: execution.routing_summary.failover_triggered,
        },
      });

      let invoice = null;
      if (auto_invoice && execution.intent.status === 'succeeded') {
        const invNum = `INV-${req.envMode.toUpperCase()}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        invoice = await db.queryOne(
          `INSERT INTO invoices (invoice_number, intent_id, merchant_id, env_mode, status, amount_cents, currency, customer_email)
           VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
           RETURNING *`,
          [
            invNum,
            execution.intent.id,
            req.merchantId,
            req.envMode,
            execution.intent.amount_cents,
            execution.intent.currency,
            execution.intent.customer_email,
          ]
        );
        await enqueueInvoiceGeneration({
          invoiceId: invoice.id,
          intentId: execution.intent.id,
          merchantId: req.merchantId,
          envMode: req.envMode,
        });
      }

      return res.status(201).json({
        ...execution,
        invoice,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/confirm',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }

      const execution = await routingEngine.executeRoutedPayment({
        intent,
        card: req.body?.card || null,
        vaultToken: req.body?.vault_token || null,
      });

      return res.json(execution);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/capture',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }
      if (intent.status !== 'requires_capture') {
        return res.status(409).json({
          error: {
            code: 'invalid_capture_state',
            message: `Intent must be in 'requires_capture' state (currently '${intent.status}').`,
          },
        });
      }

      const attempt = await db.queryOne(`SELECT * FROM payment_attempts WHERE id = $1`, [
        intent.active_attempt_id,
      ]);
      const adapter = getConnectorAdapter(attempt.connector);
      const credentials = await getConnectorCredentials(req.merchantId, attempt.connector, req.envMode);

      const capRes = await adapter.capture({
        connectorTransactionId: attempt.connector_transaction_id,
        amountCents: req.body?.amount_cents || intent.amount_cents,
        currency: intent.currency,
        credentials,
      });

      if (!capRes.ok) {
        return res.status(502).json({
          error: { code: capRes.errorCode, message: capRes.errorMessage },
        });
      }

      const updatedAttempt = await stateMachine.finalizeAttempt(attempt.id, attempt.status, 'charged');
      const updatedIntent = await stateMachine.transitionIntent(intent.id, 'succeeded');

      return res.json({ intent: updatedIntent, active_attempt: updatedAttempt });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/refund',
  requirePermission('payments', 'write'),
  idempotencyMiddleware(),
  async (req, res, next) => {
    try {
      const intent = await db.queryOne(
        `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
        [req.params.id, req.merchantId, req.envMode]
      );
      if (!intent) {
        return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
      }
      if (intent.status !== 'succeeded') {
        return res.status(409).json({
          error: { code: 'invalid_refund_state', message: 'Only succeeded payments can be refunded.' },
        });
      }

      const attempt = await db.queryOne(`SELECT * FROM payment_attempts WHERE id = $1`, [
        intent.active_attempt_id,
      ]);
      const refundAmount = Number(req.body?.amount_cents || intent.amount_cents);
      const reason = req.body?.reason || 'requested_by_customer';

      const adapter = getConnectorAdapter(attempt.connector);
      const credentials = await getConnectorCredentials(req.merchantId, attempt.connector, req.envMode);
      const refRes = await adapter.refund({
        connectorTransactionId: attempt.connector_transaction_id,
        amountCents: refundAmount,
        currency: intent.currency,
        reason,
        credentials,
      });

      const refundRow = await db.queryOne(
        `INSERT INTO refunds (
           intent_id, attempt_id, env_mode, merchant_id, connector,
           connector_transaction_id, connector_refund_id, amount_cents, currency, refund_status, reason
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          intent.id,
          attempt.id,
          req.envMode,
          req.merchantId,
          attempt.connector,
          attempt.connector_transaction_id,
          refRes.connectorRefundId,
          refundAmount,
          intent.currency,
          refRes.ok ? 'succeeded' : 'failed',
          reason,
        ]
      );

      if (refRes.ok) {
        await enqueueWebhookEvent({
          merchantId: req.merchantId,
          envMode: req.envMode,
          eventType: 'refund.succeeded',
          payload: {
            refund_id: refundRow.id,
            intent_id: intent.id,
            amount_cents: refundAmount,
            currency: intent.currency,
            connector: attempt.connector,
          },
        });
      }

      return res.status(refRes.ok ? 201 : 502).json({ refund: refundRow });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requirePermission('payments', 'read'), async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const result = await db.query(
      `SELECT pi.*,
              pa.connector AS active_connector,
              pa.connector_transaction_id,
              pa.error_code AS last_error_code,
              pa.metadata AS attempt_metadata
       FROM payment_intents pi
       LEFT JOIN payment_attempts pa ON pa.id = pi.active_attempt_id
       WHERE pi.merchant_id = $1 AND pi.env_mode = $2
       ORDER BY pi.created_at DESC
       LIMIT $3`,
      [req.merchantId, req.envMode, limit]
    );
    res.json({ mode: req.envMode, count: result.rows.length, items: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('payments', 'read'), async (req, res, next) => {
  try {
    const intent = await db.queryOne(
      `SELECT * FROM payment_intents WHERE id = $1 AND merchant_id = $2 AND env_mode = $3`,
      [req.params.id, req.merchantId, req.envMode]
    );
    if (!intent) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }

    const attemptsRes = await db.query(
      `SELECT * FROM payment_attempts WHERE intent_id = $1 ORDER BY attempt_index ASC`,
      [intent.id]
    );
    const refundsRes = await db.query(
      `SELECT * FROM refunds WHERE intent_id = $1 ORDER BY created_at DESC`,
      [intent.id]
    );

    res.json({
      intent,
      attempts: attemptsRes.rows,
      refunds: refundsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
