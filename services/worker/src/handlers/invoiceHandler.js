const db = require('../../../../shared/db');
const queue = require('../../../../shared/queue');
const { storeInvoicePdf } = require('../../../../shared/invoiceStorage');
const { invoicesCounter } = require('../../../../shared/metrics');
const { createLogger } = require('../../../../shared/logger');

const log = createLogger('worker-invoices');

async function handleInvoiceGenerate(jobPayload) {
  const { invoiceId, invoiceNumber, payment } = jobPayload;
  try {
    const stored = await storeInvoicePdf({ invoiceNumber, payment });
    await db.query(
      `UPDATE invoices
       SET storage_driver = $1,
           s3_bucket = $2,
           object_key = $3,
           file_size_bytes = $4,
           status = 'ready',
           generated_at = NOW()
       WHERE id = $5`,
      [stored.storageDriver, stored.s3Bucket, stored.objectKey, stored.sizeBytes, invoiceId]
    );

    invoicesCounter.inc({ status: 'ready', storage_driver: stored.storageDriver });
    log.info('Invoice PDF generated & marked ready', { invoiceId, invoiceNumber, driver: stored.storageDriver });

    await queue.enqueueJob('webhook.dispatch_event', {
      envMode: payment.env_mode,
      merchantId: payment.merchant_id,
      eventType: 'invoice.ready',
      data: { invoiceId, invoiceNumber, paymentId: payment.id }
    });
  } catch (err) {
    invoicesCounter.inc({ status: 'failed', storage_driver: 'unknown' });
    await db.query(`UPDATE invoices SET status = 'failed' WHERE id = $1`, [invoiceId]);
    log.error('Invoice generation failed in worker', { invoiceId, error: err.message });
  }
}

module.exports = { handleInvoiceGenerate };
