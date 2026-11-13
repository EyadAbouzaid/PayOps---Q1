const express = require('express');
const db = require('../../../../../shared/db');
const queue = require('../../../../../shared/queue');
const config = require('../../../../../shared/config');
const { computeHmacSignature } = require('../../../../../shared/webhookSender');
const { createLogger } = require('../../../../../shared/logger');

const router = express.Router();
const log = createLogger('webhooks');

router.get('/health', async (req, res) => {
  try {
    const dbLatencyMs = await db.pingDatabase();
    res.json({ feature: 'webhooks', healthy: true, dbLatencyMs });
  } catch (err) {
    res.status(503).json({ feature: 'webhooks', healthy: false, error: err.message });
  }
});

router.get('/endpoints', async (req, res) => {
  const result = await db.query(
    'SELECT id, env_mode, merchant_id, target_url, events, active, created_at FROM webhook_endpoints WHERE env_mode = $1 ORDER BY created_at DESC',
    [req.envMode]
  );
  res.json({ mode: req.envMode, endpoints: result.rows });
});

router.post('/endpoints', async (req, res) => {
  const { target_url, merchant_id = 'merch_default', signing_secret } = req.body || {};
  if (!target_url || !/^https?:\/\//i.test(target_url)) {
    return res.status(400).json({ error: 'Valid http(s) target_url is required' });
  }
  const secret = signing_secret || config.webhooks.defaultSecret;
  const inserted = await db.query(
    `INSERT INTO webhook_endpoints (env_mode, merchant_id, target_url, signing_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING id, env_mode, merchant_id, target_url, events, active, created_at`,
    [req.envMode, merchant_id, target_url, secret]
  );
  res.status(201).json({ endpoint: inserted.rows[0] });
});

router.get('/deliveries', async (req, res) => {
  const result = await db.query(
    `SELECT * FROM webhook_deliveries
     WHERE env_mode = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.envMode]
  );
  res.json({ mode: req.envMode, deliveries: result.rows });
});

// One-Click Manual Replay Button Endpoint
router.post('/deliveries/:id/replay', async (req, res) => {
  try {
    const found = await db.query(
      `SELECT wd.*, we.signing_secret
       FROM webhook_deliveries wd
       LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id
       WHERE wd.id = $1`,
      [req.params.id]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook delivery record not found' });
    }
    const record = found.rows[0];

    await queue.enqueueJob('webhook.replay', {
      deliveryId: record.id,
      endpointId: record.endpoint_id,
      envMode: record.env_mode,
      eventType: record.event_type,
      targetUrl: record.target_url,
      secret: record.signing_secret || config.webhooks.defaultSecret,
      payload: record.payload
    });

    log.info('Queued manual webhook replay', { deliveryId: record.id, traceId: req.traceId });
    res.json({ message: 'Webhook replay queued', deliveryId: record.id });
  } catch (err) {
    log.error('Webhook replay failed', { error: err.message });
    res.status(500).json({ error: 'Could not replay webhook', details: err.message });
  }
});

// Built-in Sandbox Merchant Receiver so live demos verify HMAC-SHA256 out-of-the-box
router.post('/mock-merchant', express.json(), (req, res) => {
  const sigHeader = req.headers['x-payops-signature'] || '';
  const tsHeader = req.headers['x-payops-timestamp'] || '';
  if (req.query.simulate_fail === 'true') {
    return res.status(502).json({ received: false, reason: 'Simulated downstream store outage' });
  }
  const expected = computeHmacSignature('whsec_test_sandbox_secret_key', tsHeader, JSON.stringify(req.body));
  res.status(200).json({
    received: true,
    verifiedSignature: sigHeader === expected,
    event: req.headers['x-payops-event'],
    processedAt: new Date().toISOString()
  });
});

module.exports = router;
