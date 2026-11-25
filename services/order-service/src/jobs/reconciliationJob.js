const config = require('../config');
const logger = require('../logger');

async function runReconciliationCycle({ db, paymentClient }) {
  try {
    // 1. Find PENDING_PAYMENT orders that have a payment_intent_id
    const pendingWithIntent = await db.query(
      `SELECT * FROM orders
       WHERE status = 'PENDING_PAYMENT'
         AND payment_intent_id IS NOT NULL
         AND created_at < NOW() - INTERVAL '10 seconds'
       ORDER BY created_at ASC
       LIMIT 50`
    );

    for (const order of pendingWithIntent.rows) {
      try {
        const result = await paymentClient.getPayment(order.payment_intent_id);
        if (result.orderStatus && result.orderStatus !== 'PENDING_PAYMENT') {
          await db.query(
            'UPDATE orders SET status = $1, failure_reason = $2, updated_at = NOW() WHERE id = $3',
            [result.orderStatus, result.failureReason, order.id]
          );
          logger.info('Reconciliation updated order from PayOps', {
            order_id: order.id,
            intent_id: order.payment_intent_id,
            new_status: result.orderStatus,
          });
        }
      } catch (err) {
        logger.warn('Reconciliation check failed for order', {
          order_id: order.id,
          intent_id: order.payment_intent_id,
          error: err.message,
        });
      }
    }

    // 2. Timeout orders stuck in PENDING_PAYMENT beyond PENDING_ORDER_TIMEOUT_MINUTES
    const timedOut = await db.query(
      `UPDATE orders
       SET status = 'CANCELLED',
           failure_reason = COALESCE(failure_reason, 'Payment timed out while in PENDING_PAYMENT'),
           updated_at = NOW()
       WHERE status = 'PENDING_PAYMENT'
         AND created_at < NOW() - ($1 || ' minutes')::INTERVAL
       RETURNING id`,
      [String(config.PENDING_ORDER_TIMEOUT_MINUTES)]
    );

    if (timedOut.rowCount > 0) {
      logger.info('Cancelled timed-out PENDING_PAYMENT orders', {
        count: timedOut.rowCount,
        order_ids: timedOut.rows.map((r) => r.id),
      });
    }
  } catch (err) {
    logger.error('Reconciliation cycle failed', { error: err.message });
  }
}

function startReconciliationJob({ db, paymentClient, intervalMs = config.RECONCILE_INTERVAL_MS }) {
  const timer = setInterval(() => {
    runReconciliationCycle({ db, paymentClient });
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { runReconciliationCycle, startReconciliationJob };
