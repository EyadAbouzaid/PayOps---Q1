const express = require('express');
const db = require('../../../../../shared/db');
const queue = require('../../../../../shared/queue');
const config = require('../../../../../shared/config');
const { createLogger } = require('../../../../../shared/logger');

const router = express.Router();
const log = createLogger('billing');

router.get('/health', async (req, res) => {
  try {
    const dbLatencyMs = await db.pingDatabase();
    res.json({ feature: 'billing', healthy: true, dbLatencyMs });
  } catch (err) {
    res.status(503).json({ feature: 'billing', healthy: false, error: err.message });
  }
});

router.get('/schedules', async (req, res) => {
  try {
    const schedules = await db.query(
      'SELECT * FROM billing_schedules WHERE env_mode = $1 ORDER BY created_at DESC',
      [req.envMode]
    );
    const runs = await db.query(
      `SELECT br.*, bs.name AS schedule_name, bs.schedule_type
       FROM billing_runs br
       JOIN billing_schedules bs ON bs.id = br.schedule_id
       WHERE br.env_mode = $1
       ORDER BY br.executed_at DESC
       LIMIT 30`,
      [req.envMode]
    );
    res.json({ mode: req.envMode, schedules: schedules.rows, recentRuns: runs.rows });
  } catch (err) {
    log.error('Failed fetching billing schedules', { error: err.message });
    res.status(500).json({ error: 'Failed fetching billing schedules' });
  }
});

router.post('/schedules', async (req, res) => {
  const {
    schedule_type = 'subscription',
    name,
    recipient_email,
    amount_cents,
    currency = 'USD',
    interval_cron = '0 0 1 * *'
  } = req.body || {};

  if (!name || !recipient_email || !Number.isInteger(Number(amount_cents)) || Number(amount_cents) <= 0) {
    return res.status(400).json({ error: 'name, recipient_email, and positive integer amount_cents are required' });
  }

  try {
    const inserted = await db.query(
      `INSERT INTO billing_schedules
        (env_mode, schedule_type, name, recipient_email, amount_cents, currency, interval_cron, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [req.envMode, schedule_type, name, recipient_email, Number(amount_cents), currency.toUpperCase(), interval_cron]
    );
    res.status(201).json({ schedule: inserted.rows[0] });
  } catch (err) {
    log.error('Failed creating billing schedule', { error: err.message });
    res.status(500).json({ error: 'Could not create schedule', details: err.message });
  }
});

// Triggered by AWS EventBridge Cron Rule OR Dashboard "Run Due Batch Now" button
router.post('/run-due', async (req, res) => {
  const triggeredBy = req.headers['x-eventbridge-token'] === config.cronTriggerToken
    ? 'aws-eventbridge'
    : 'manual-api';

  try {
    const due = await db.query(
      `SELECT * FROM billing_schedules
       WHERE env_mode = $1 AND active = TRUE AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 50`,
      [req.envMode]
    );

    const queuedIds = [];
    for (const schedule of due.rows) {
      await queue.enqueueJob('billing.execute_schedule', {
        scheduleId: schedule.id,
        envMode: req.envMode,
        triggeredBy
      });
      queuedIds.push(schedule.id);
    }

    log.info('Queued due payroll & subscription schedules', {
      count: queuedIds.length,
      triggeredBy,
      mode: req.envMode
    });

    res.json({
      triggeredBy,
      mode: req.envMode,
      queuedCount: queuedIds.length,
      scheduleIds: queuedIds
    });
  } catch (err) {
    log.error('Failed queuing due billing runs', { error: err.message });
    res.status(500).json({ error: 'Billing batch trigger failed', details: err.message });
  }
});

module.exports = router;
