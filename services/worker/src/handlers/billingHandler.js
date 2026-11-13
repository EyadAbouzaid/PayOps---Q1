const db = require('../../../../shared/db');
const queue = require('../../../../shared/queue');
const config = require('../../../../shared/config');
const { billingRunsCounter } = require('../../../../shared/metrics');
const { createLogger } = require('../../../../shared/logger');

const log = createLogger('worker-billing');

async function handleBillingScheduleExecute(jobPayload) {
  const { scheduleId, envMode, triggeredBy } = jobPayload;
  const schedRes = await db.query('SELECT * FROM billing_schedules WHERE id = $1', [scheduleId]);
  if (schedRes.rows.length === 0) return;
  const schedule = schedRes.rows[0];

  try {
    const payRes = await db.query(
      `INSERT INTO payments
        (env_mode, merchant_id, customer_email, customer_name, amount_cents, currency, status, description, processed_by_host)
       VALUES ($1, 'merch_scheduler', $2, $3, $4, $5, 'succeeded', $6, $7)
       RETURNING *`,
      [
        envMode,
        schedule.recipient_email,
        schedule.name,
        schedule.amount_cents,
        schedule.currency,
        `Automated ${schedule.schedule_type}: ${schedule.name}`,
        config.hostname
      ]
    );
    const payment = payRes.rows[0];

    await db.query(
      `INSERT INTO billing_runs (schedule_id, env_mode, payment_id, status, triggered_by)
       VALUES ($1, $2, $3, 'completed', $4)`,
      [schedule.id, envMode, payment.id, triggeredBy]
    );

    await db.query(
      `UPDATE billing_schedules
       SET last_run_at = NOW(),
           next_run_at = NOW() + INTERVAL '30 days'
       WHERE id = $1`,
      [schedule.id]
    );

    const invoiceNumber = `INV-${Date.now()}-${payment.id.slice(0, 6).toUpperCase()}`;
    const invRes = await db.query(
      `INSERT INTO invoices (invoice_number, payment_id, env_mode, object_key, status)
       VALUES ($1, $2, $3, $4, 'generating')
       RETURNING *`,
      [invoiceNumber, payment.id, envMode, `invoices/${envMode}/${invoiceNumber}.pdf`]
    );

    await queue.enqueueJob('invoice.generate', {
      invoiceId: invRes.rows[0].id,
      invoiceNumber,
      payment
    });

    billingRunsCounter.inc({ schedule_type: schedule.schedule_type, status: 'completed' });
    log.info('Executed scheduled billing/payroll run', {
      scheduleId: schedule.id,
      paymentId: payment.id,
      type: schedule.schedule_type
    });
  } catch (err) {
    billingRunsCounter.inc({ schedule_type: schedule.schedule_type, status: 'failed' });
    await db.query(
      `INSERT INTO billing_runs (schedule_id, env_mode, status, triggered_by, error_message)
       VALUES ($1, $2, 'failed', $3, $4)`,
      [schedule.id, envMode, triggeredBy, err.message]
    );
    log.error('Scheduled billing execution failed', { scheduleId, error: err.message });
  }
}

module.exports = { handleBillingScheduleExecute };
