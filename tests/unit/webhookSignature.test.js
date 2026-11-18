const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHmacSignature } = require('../../shared/webhookSender');
const { signLocalDownloadToken } = require('../../shared/invoiceStorage');
const { createLogger, getRecentLogs } = require('../../shared/logger');

test('HMAC-SHA256 webhook signature is deterministic and formatted with timestamp', () => {
  const payload = JSON.stringify({ event: 'payment.succeeded', amount_cents: 5000 });
  const sig1 = computeHmacSignature('whsec_unit_test', 1700000000, payload);
  const sig2 = computeHmacSignature('whsec_unit_test', 1700000000, payload);
  assert.equal(sig1, sig2);
  assert.match(sig1, /^t=1700000000,v1=[a-f0-9]{64}$/);
});

test('Local invoice pre-signed token changes with expiry', () => {
  const t1 = signLocalDownloadToken('inv-123', 1800000000);
  const t2 = signLocalDownloadToken('inv-123', 1800000900);
  assert.notEqual(t1, t2);
});

test('Structured logger stores feature-filterable logs for System & Logs UI tab', () => {
  const payLog = createLogger('payments');
  payLog.info('Unit test payment log entry');
  const filtered = getRecentLogs({ feature: 'payments', limit: 10 });
  assert.ok(filtered.length >= 1);
  assert.equal(filtered[0].feature, 'payments');
});
