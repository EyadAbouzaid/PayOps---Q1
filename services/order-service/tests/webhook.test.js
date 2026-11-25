const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyPayOpsSignature, processWebhookEvent } = require('../src/webhooks/payopsWebhook');

const SECRET = 'whsec_test_unit_secret_987654321';

function makeSignedHeaders(rawBody, tsSec, secret = SECRET) {
  const sig = crypto.createHmac('sha256', secret).update(`${tsSec}.${rawBody}`).digest('hex');
  return {
    timestampHeader: String(tsSec),
    signatureHeader: `t=${tsSec},v1=${sig}`,
  };
}

test('verifyPayOpsSignature accepts valid signature within 5 minutes', () => {
  const now = 1700000000;
  const rawBody = JSON.stringify({ id: 'del_1', event_type: 'payment.succeeded', data: { intent_id: 'pi_1' } });
  const { timestampHeader, signatureHeader } = makeSignedHeaders(rawBody, now - 60);

  const result = verifyPayOpsSignature({
    rawBody,
    timestampHeader,
    signatureHeader,
    secret: SECRET,
    nowSec: now,
  });
  assert.equal(result.valid, true);
});

test('verifyPayOpsSignature rejects invalid secret and tampered body', () => {
  const now = 1700000000;
  const rawBody = JSON.stringify({ id: 'del_1', event_type: 'payment.succeeded', data: { intent_id: 'pi_1' } });
  const { timestampHeader, signatureHeader } = makeSignedHeaders(rawBody, now, 'wrong_secret');

  const invalidSecret = verifyPayOpsSignature({ rawBody, timestampHeader, signatureHeader, secret: SECRET, nowSec: now });
  assert.equal(invalidSecret.valid, false);

  const validForOrig = makeSignedHeaders(rawBody, now, SECRET);
  const tamperedBody = JSON.stringify({ id: 'del_1', event_type: 'payment.succeeded', data: { intent_id: 'pi_HACKED' } });
  const tamperedRes = verifyPayOpsSignature({
    rawBody: tamperedBody,
    timestampHeader: validForOrig.timestampHeader,
    signatureHeader: validForOrig.signatureHeader,
    secret: SECRET,
    nowSec: now,
  });
  assert.equal(tamperedRes.valid, false);
});

test('verifyPayOpsSignature rejects timestamps older than 5 minutes', () => {
  const now = 1700000000;
  const oldTs = now - 301; // 5 minutes + 1 second old
  const rawBody = JSON.stringify({ id: 'del_old', event_type: 'payment.succeeded' });
  const { timestampHeader, signatureHeader } = makeSignedHeaders(rawBody, oldTs);

  const res = verifyPayOpsSignature({ rawBody, timestampHeader, signatureHeader, secret: SECRET, nowSec: now });
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'timestamp_expired');
});

test('processWebhookEvent enforces idempotency on X-PayOps-Delivery-Id', async () => {
  const seenDeliveries = new Set();
  const orderUpdates = [];

  const fakeDb = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO processed_webhook_events')) {
        const deliveryId = params[0];
        if (seenDeliveries.has(deliveryId)) {
          return { rowCount: 0, rows: [] };
        }
        seenDeliveries.add(deliveryId);
        return { rowCount: 1, rows: [{ delivery_id: deliveryId }] };
      }
      if (sql.includes('SELECT * FROM orders WHERE payment_intent_id')) {
        return { rowCount: 1, rows: [{ id: 'ord_1', status: 'PENDING_PAYMENT', payment_intent_id: params[0] }] };
      }
      if (sql.includes('UPDATE orders SET status')) {
        orderUpdates.push(params);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const payload = { id: 'del_dup_1', event_type: 'payment.succeeded', data: { intent_id: 'pi_1' } };

  const first = await processWebhookEvent(fakeDb, { deliveryId: 'del_dup_1', eventType: 'payment.succeeded', payload });
  assert.equal(first.processed, true);
  assert.equal(orderUpdates.length, 1);

  const second = await processWebhookEvent(fakeDb, { deliveryId: 'del_dup_1', eventType: 'payment.succeeded', payload });
  assert.equal(second.duplicate, true);
  assert.equal(orderUpdates.length, 1); // Still updated only once!
});
