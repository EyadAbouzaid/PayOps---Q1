const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const client = require('prom-client');
const config = require('./config');
const logger = require('./logger');
const { PaymentClient, PaymentClientError } = require('./clients/PaymentClient');
const { createWebhookRouter } = require('./webhooks/payopsWebhook');
const { runReconciliationCycle } = require('./jobs/reconciliationJob');

const VALID_TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function createApp({ db, paymentClient = new PaymentClient() }) {
  const app = express();
  app.use(cors());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  const orderCounter = new client.Counter({
    name: 'ecommerce_orders_total',
    help: 'Total orders created by status',
    labelNames: ['status'],
    registers: [register],
  });

  // Liveness & Readiness & Metrics
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'order-service' }));
  app.get('/ready', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.status(200).json({ status: 'ready', service: 'order-service' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Mount Webhook router BEFORE global express.json() so raw body signature verification works cleanly
  app.use('/api/webhooks', createWebhookRouter({ db }));

  // JSON parser for standard API routes
  app.use(express.json());

  // User JWT auth middleware (end users only; unrelated to PayOps API keys)
  function requireUserAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Missing user JWT token' } });
    }
    try {
      const decoded = jwt.verify(auth.slice(7), config.JWT_SECRET);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: { code: 'invalid_token', message: 'Invalid or expired JWT' } });
    }
  }

  // Create order & optionally initiate PayOps payment
  app.post('/api/orders', requireUserAuth, async (req, res) => {
    const { items, card = null, vault_token = null, customer_email = null } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: { code: 'empty_items', message: 'Order must contain at least one item' } });
    }

    // Validate integer cents
    let totalAmountCents = 0;
    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const unitCents = parseInt(item.unit_price_cents, 10);
      if (!item.product_id || !item.product_name || !Number.isInteger(qty) || qty <= 0 || !Number.isInteger(unitCents) || unitCents <= 0) {
        return res.status(400).json({
          error: { code: 'invalid_item', message: 'Each item requires product_id, product_name, positive integer quantity, and positive integer unit_price_cents' },
        });
      }
      totalAmountCents += qty * unitCents;
    }

    const pgClient = await db.getClient();
    let createdOrder;
    try {
      await pgClient.query('BEGIN');
      const orderRes = await pgClient.query(
        `INSERT INTO orders (user_id, customer_email, status, total_amount_cents, currency)
         VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4)
         RETURNING *`,
        [req.user.sub, customer_email || req.user.email || null, totalAmountCents, config.CURRENCY]
      );
      createdOrder = orderRes.rows[0];

      for (const item of items) {
        await pgClient.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents)
           VALUES ($1, $2, $3, $4, $5)`,
          [createdOrder.id, item.product_id, item.product_name, parseInt(item.quantity, 10), parseInt(item.unit_price_cents, 10)]
        );
      }
      await pgClient.query('COMMIT');
    } catch (err) {
      await pgClient.query('ROLLBACK');
      logger.error('Failed to persist order', { error: err.message });
      return res.status(500).json({ error: { code: 'db_error', message: 'Could not create order' } });
    } finally {
      pgClient.release();
    }

    // If payment details (card or vault_token) were provided at checkout, pay immediately via PaymentClient
    if (card || vault_token) {
      try {
        const payResult = await paymentClient.createPayment({
          id: createdOrder.id,
          total_amount_cents: createdOrder.total_amount_cents,
          customer_email: createdOrder.customer_email,
          card,
          vault_token,
        });

        const updatedRes = await db.query(
          `UPDATE orders
           SET payment_intent_id = $1,
               status = $2,
               failure_reason = $3,
               updated_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [payResult.intentId, payResult.orderStatus, payResult.failureReason, createdOrder.id]
        );
        createdOrder = updatedRes.rows[0];
      } catch (err) {
        // Rule 7: On 5xx or timeout, keep order PENDING_PAYMENT so retry/reconciliation can complete it
        logger.warn('PaymentClient error during order checkout; order remains PENDING_PAYMENT', {
          order_id: createdOrder.id,
          error: err.message,
          retryable: err instanceof PaymentClientError ? err.isRetryable : true,
        });
      }
    }

    orderCounter.inc({ status: createdOrder.status });
    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [createdOrder.id]);
    return res.status(201).json({ order: { ...createdOrder, items: itemsRes.rows } });
  });

  // Pay or retry payment for an existing PENDING_PAYMENT / PAYMENT_FAILED order using the SAME Idempotency-Key (order.id)
  app.post('/api/orders/:id/pay', requireUserAuth, async (req, res) => {
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.sub]);
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
    }
    const order = orderRes.rows[0];
    if (order.status === 'PAID') {
      return res.status(200).json({ order });
    }

    const { card = null, vault_token = null } = req.body || {};
    if (!card && !vault_token && !order.payment_intent_id) {
      return res.status(400).json({ error: { code: 'missing_payment_method', message: 'Provide card or vault_token' } });
    }

    try {
      const payResult = await paymentClient.createPayment({
        id: order.id,
        total_amount_cents: order.total_amount_cents,
        customer_email: order.customer_email,
        payment_intent_id: order.payment_intent_id,
        card,
        vault_token,
      });

      const updated = await db.query(
        `UPDATE orders
         SET payment_intent_id = COALESCE($1, payment_intent_id),
             status = $2,
             failure_reason = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [payResult.intentId, payResult.orderStatus, payResult.failureReason, order.id]
      );
      return res.status(200).json({ order: updated.rows[0] });
    } catch (err) {
      logger.warn('Retry payment failed; keeping current order status', { order_id: order.id, error: err.message });
      return res.status(502).json({
        error: { code: 'payment_upstream_unavailable', message: 'Payment provider unavailable; order kept in PENDING_PAYMENT' },
        order,
      });
    }
  });

  // Payment-status fallback endpoint (polls PayOps directly via PaymentClient.getPayment)
  app.post('/api/orders/:id/sync-payment', requireUserAuth, async (req, res) => {
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.sub]);
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
    }
    const order = orderRes.rows[0];
    if (!order.payment_intent_id) {
      return res.status(400).json({ error: { code: 'no_payment_intent', message: 'Order has no payment_intent_id yet' } });
    }

    try {
      const payResult = await paymentClient.getPayment(order.payment_intent_id);
      const updated = await db.query(
        `UPDATE orders
         SET status = $1, failure_reason = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [payResult.orderStatus, payResult.failureReason, order.id]
      );
      return res.status(200).json({ order: updated.rows[0], payops_status: payResult.rawStatus });
    } catch (err) {
      return res.status(502).json({ error: { code: 'sync_failed', message: err.message } });
    }
  });

  // Trigger reconciliation manually (helpful in CI/integration tests)
  app.post('/api/orders/reconcile', async (_req, res) => {
    await runReconciliationCycle({ db, paymentClient });
    res.status(200).json({ reconciled: true });
  });

  // List user orders
  app.get('/api/orders', requireUserAuth, async (req, res) => {
    const ordersRes = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.sub]
    );
    res.json({ orders: ordersRes.rows });
  });

  // Get single order with items
  app.get('/api/orders/:id', requireUserAuth, async (req, res) => {
    const orderRes = await db.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
    }
    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
    res.json({ order: { ...orderRes.rows[0], items: itemsRes.rows } });
  });

  // Update order lifecycle status (PAID -> SHIPPED -> DELIVERED / CANCELLED)
  app.patch('/api/orders/:id/status', requireUserAuth, async (req, res) => {
    const { status } = req.body || {};
    const orderRes = await db.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
    }
    const order = orderRes.rows[0];
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(409).json({
        error: { code: 'invalid_status_transition', message: `Cannot transition from ${order.status} to ${status}` },
      });
    }

    // If cancelling a PAID order with a payment_intent_id, trigger PayOps refund via PaymentClient
    if (status === 'CANCELLED' && order.status === 'PAID' && order.payment_intent_id) {
      try {
        await paymentClient.refund(order.payment_intent_id);
      } catch (err) {
        return res.status(502).json({ error: { code: 'refund_failed', message: err.message } });
      }
    }

    const updated = await db.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, order.id]
    );
    return res.json({ order: updated.rows[0] });
  });

  return app;
}

module.exports = { createApp };
