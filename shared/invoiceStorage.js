const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const config = require('./config');
const { createLogger } = require('./logger');

const log = createLogger('invoices-storage');

function renderInvoicePdfBuffer({ invoiceNumber, payment }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#0f172a').text('PAYOPS OFFICIAL INVOICE', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#475569').text(`Environment Mode: ${String(payment.env_mode).toUpperCase()}`);
    doc.text(`Invoice Number: ${invoiceNumber}`);
    doc.text(`Issued At (UTC): ${new Date().toISOString()}`);
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#0f172a').text('Bill To:', { underline: true });
    doc.fontSize(11).fillColor('#1e293b').text(payment.customer_name || 'Customer');
    doc.text(payment.customer_email);
    doc.moveDown(1.2);

    doc.fontSize(12).fillColor('#0f172a').text('Transaction Summary', { underline: true });
    doc.moveDown(0.5);
    const amountFormatted = (Number(payment.amount_cents) / 100).toFixed(2);
    doc.fontSize(11).fillColor('#1e293b');
    doc.text(`Payment ID: ${payment.id}`);
    doc.text(`Merchant ID: ${payment.merchant_id}`);
    doc.text(`Description: ${payment.description || 'PayOps Processed Payment'}`);
    doc.text(`Status: ${String(payment.status).toUpperCase()}`);
    doc.moveDown(0.8);
    doc.fontSize(15).fillColor('#0284c7').text(`Total Paid: ${amountFormatted} ${payment.currency}`);

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#64748b').text(
      'Generated automatically by PayOps High-Reliability Payment & Billing Engine.',
      { align: 'center' }
    );
    doc.end();
  });
}

async function storeInvoicePdf({ invoiceNumber, payment }) {
  const buffer = await renderInvoicePdfBuffer({ invoiceNumber, payment });
  const objectKey = `invoices/${payment.env_mode}/${invoiceNumber}.pdf`;

  if (config.storage.s3Bucket) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: config.awsRegion });
    await s3.send(new PutObjectCommand({
      Bucket: config.storage.s3Bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256'
    }));
    log.info('Uploaded official PDF invoice to Amazon S3', {
      bucket: config.storage.s3Bucket,
      objectKey,
      bytes: buffer.length
    });
    return {
      storageDriver: 's3',
      s3Bucket: config.storage.s3Bucket,
      objectKey,
      sizeBytes: buffer.length
    };
  }

  const fullLocalPath = path.join(config.storage.localDir, objectKey);
  fs.mkdirSync(path.dirname(fullLocalPath), { recursive: true });
  fs.writeFileSync(fullLocalPath, buffer);
  log.info('Stored official PDF invoice in local volume (S3_BUCKET_NAME unset)', {
    fullLocalPath,
    bytes: buffer.length
  });
  return {
    storageDriver: 'local',
    s3Bucket: null,
    objectKey,
    sizeBytes: buffer.length
  };
}

function signLocalDownloadToken(invoiceId, expiresEpochSec) {
  return crypto
    .createHmac('sha256', config.storage.localSigningSecret)
    .update(`${invoiceId}:${expiresEpochSec}`)
    .digest('hex');
}

async function createTimeLimitedDownloadUrl(invoice, baseUrl = '') {
  const ttl = config.storage.presignedTtlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  if (invoice.storage_driver === 's3' && invoice.s3_bucket) {
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const s3 = new S3Client({ region: config.awsRegion });
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: invoice.s3_bucket, Key: invoice.object_key }),
      { expiresIn: ttl }
    );
    return { url, expiresAt, driver: 's3' };
  }

  const expiresEpochSec = Math.floor(Date.now() / 1000) + ttl;
  const sig = signLocalDownloadToken(invoice.id, expiresEpochSec);
  const url = `${baseUrl}/api/invoices/${invoice.id}/file?expires=${expiresEpochSec}&sig=${sig}`;
  return { url, expiresAt, driver: 'local' };
}

module.exports = {
  storeInvoicePdf,
  createTimeLimitedDownloadUrl,
  signLocalDownloadToken
};
