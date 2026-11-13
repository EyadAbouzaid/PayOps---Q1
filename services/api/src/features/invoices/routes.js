const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../../../../../shared/db');
const config = require('../../../../../shared/config');
const { createTimeLimitedDownloadUrl, signLocalDownloadToken } = require('../../../../../shared/invoiceStorage');
const { createLogger } = require('../../../../../shared/logger');

const router = express.Router();
const log = createLogger('invoices');

router.get('/health', async (req, res) => {
  try {
    const dbLatencyMs = await db.pingDatabase();
    res.json({
      feature: 'invoices',
      healthy: true,
      storageDriver: config.storage.s3Bucket ? 's3' : 'local',
      dbLatencyMs
    });
  } catch (err) {
    res.status(503).json({ feature: 'invoices', healthy: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT i.*, p.customer_email, p.amount_cents, p.currency
       FROM invoices i
       JOIN payments p ON p.id = i.payment_id
       WHERE i.env_mode = $1
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [req.envMode]
    );
    res.json({ mode: req.envMode, invoices: result.rows });
  } catch (err) {
    log.error('Failed listing invoices', { error: err.message, traceId: req.traceId });
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

// Generate secure time-limited download link (S3 Pre-Signed URL or HMAC local link)
router.get('/:id/download-url', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    if (invoice.status !== 'ready') {
      return res.status(409).json({
        error: 'Invoice PDF is still generating in background worker',
        status: invoice.status
      });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const signed = await createTimeLimitedDownloadUrl(invoice, baseUrl);
    res.json({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      storageDriver: signed.driver
    });
  } catch (err) {
    log.error('Failed generating invoice pre-signed URL', { error: err.message, traceId: req.traceId });
    res.status(500).json({ error: 'Could not generate download link', details: err.message });
  }
});

// Local fallback signed file stream (used when S3_BUCKET_NAME is not configured)
router.get('/:id/file', async (req, res) => {
  const { expires, sig } = req.query;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!expires || !sig || Number(expires) < nowSec) {
    return res.status(403).json({ error: 'Download link expired or missing signature' });
  }
  const expectedSig = signLocalDownloadToken(req.params.id, expires);
  if (expectedSig !== sig) {
    return res.status(403).json({ error: 'Invalid download signature' });
  }

  const result = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

  const filePath = path.join(config.storage.localDir, result.rows[0].object_key);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file missing on local volume' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${result.rows[0].invoice_number}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
