const express = require('express');
const db = require('../../../../../shared/db');
const queue = require('../../../../../shared/queue');
const config = require('../../../../../shared/config');
const { createLogger } = require('../../../../../shared/logger');
const { transactionsCounter } = require('../../../../../shared/metrics');

const router = express.Router();
const log = createLogger('payments');

// Dedicated Microservice/Feature Health Probe
router.get('/health', async (req, res) => {
  try {
    const latencyMs = await db.pingDatabase();
    res.json({ feature: 'payments', healthy: true, dbLatencyMs: latencyMs });
  } catch (err) {
    res.status(503).json({ feature: 'payments', healthy: false, error: err.message });
  }
});

// List recent payments isolated by Test Mode vs Live Mode
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const result = await db.query(
      `SELECT p.*, i.id AS invoice_id, i.invoice_number, i.status AS invoice_status
       FROM payments p
       LEFT JOIN invoices i ON i.payment_id = p.id
       WHERE p.env_mode = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [req.envMode, limit]
    );
    res.json({ mode: req.envMode, count: result.rows.length, payments: result.rows });
  } catch (err) {
    log.error('Failed listing payments', { error: err.message, traceId: req.traceId });
    res.status(500).json({ error: 'Failed to fetch payments', details: err.message });
  }
});

// Create & Process Payment + Async PDF Invoice + Signed Webhook Notification
router.post('/', async (req, res) => {
  const {
    customer_email = 'buyer@merchant-example.com',
    customer_name = 'Demo Buyer',
    amount_cents,
    currency = 'USD',
    merchant_id = 'merch_default',
    description = 'Order Checkout',
    idempotency_key = null
  } = req.body || {};

  const parsedAmount = Number(amount_cents);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      error: 'Invalid amount_cents: must be a positive integer (e.g. 4999 for $49.99)'
    });
  }

  try {
    if (idempotency_key) {
      const existing = await db.query(
        'SELECT * FROM payments WHERE idempotency_key = $1',
        [idempotency_key]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({
          idempotentReplay: true,
          payment: existing.rows[0]
        });
      }
    }

    const insertPayment = await db.query(
      `INSERT INTO payments
        (idempotency_key, env_mode, merchant_id, customer_email, customer_name, amount_cents, currency, status, description, processed_by_host)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8, $9)
       RETURNING *`,
      [
        idempotency_key,
        req.envMode,
        merchant_id,
        customer_email,
        customer_name,
        parsedAmount,
        String(currency).toUpperCase(),
        description,
        config.hostname
      ]
    );

    const payment = insertPayment.rows[0];
    transactionsCounter.inc({
      status: payment.status,
      env_mode: req.envMode,
      currency: payment.currency
    });

    // Create pending invoice record & offload heavy PDF rendering + S3 upload to Worker Queue
    const invoiceNumber = `INV-${Date.now()}-${payment.id.slice(0, 6).toUpperCase()}`;
    const insertInvoice = await db.query(
      `INSERT INTO invoices (invoice_number, payment_id, env_mode, object_key, status)
       VALUES ($1, $2, $3, $4, 'generating')
       RETURNING *`,
      [invoiceNumber, payment.id, req.envMode, `invoices/${req.envMode}/${invoiceNumber}.pdf`]
    );

    await queue.enqueueJob('invoice.generate', {
      invoiceId: insertInvoice.rows[0].id,
      invoiceNumber,
      payment
    });

    await queue.enqueueJob('webhook.dispatch_event', {
      envMode: req.envMode,
      merchantId: payment.merchant_id,
      eventType: 'payment.succeeded',
      data: payment
    });

    log.info('Payment processed and async tasks queued', {
      paymentId: payment.id,
      invoiceId: insertInvoice.rows[0].id,
      amountCents: payment.amount_cents,
      mode: req.envMode,
      traceId: req.traceId
    });

    res.status(201).json({
      payment,
      invoice: insertInvoice.rows[0],
      message: 'Payment succeeded; PDF invoice generation and signed webhook queued asynchronously.'
    });
  } catch (err) {
    transactionsCounter.inc({ status: 'failed', env_mode: req.envMode, currency: 'USD' });
    log.error('Payment creation failed', { error: err.message, traceId: req.traceId });
    res.status(500).json({ error: 'Payment processing failed', details: err.message });
  }
});

module.exports = router;
