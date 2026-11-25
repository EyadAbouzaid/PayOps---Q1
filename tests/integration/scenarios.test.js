/**
 * Integration Scenarios against running Docker Compose stack (Rule 12):
 * 1. Success (immediate + async webhook)
 * 2. Duplicate webhook (idempotency)
 * 3. Lost webhook (reconciliation fixes it)
 * 4. PayOps down (503 -> order stays PENDING_PAYMENT)
 * 5. Payment failure (card ending in 0002 -> PAYMENT_FAILED)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const AUTH_URL = process.env.AUTH_URL || 'http://localhost:4004';
const PRODUCT_URL = process.env.PRODUCT_URL || 'http://localhost:4002';
const ORDER_URL = process.env.ORDER_URL || 'http://localhost:4001';
const PAYOPS_MOCK_URL = process.env.PAYOPS_MOCK_URL || 'http://localhost:3005';

async function createUserAndItem() {
  const email = `integ_${Date.now()}_${Math.random().toString(36).slice(2)}@store.io`;
  const reg = await fetch(`${AUTH_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!', full_name: 'Integ User' }),
  });
  const { token } = await reg.json();
  const prods = await (await fetch(`${PRODUCT_URL}/api/products`)).json();
  const p = prods.products[0];
  return {
    token,
    item: { product_id: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: 1 },
  };
}

test('Scenario 1 & 2: Async webhook marks order PAID and duplicate webhook is safely ignored', async () => {
  await fetch(`${PAYOPS_MOCK_URL}/_mock/reset`, { method: 'POST' });
  await fetch(`${PAYOPS_MOCK_URL}/_mock/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asyncProcessing: true, webhookMode: 'duplicate' }),
  });

  const { token, item } = await createUserAndItem();
  const createRes = await fetch(`${ORDER_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [item],
      card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
    }),
  });
  const { order } = await createRes.json();
  assert.equal(order.status, 'PENDING_PAYMENT');

  // Wait for async duplicate webhooks to arrive and settle
  await new Promise((r) => setTimeout(r, 2000));
  const check = await (await fetch(`${ORDER_URL}/api/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  assert.equal(check.order.status, 'PAID');
});

test('Scenario 3: Lost webhook is recovered by reconciliation job', async () => {
  await fetch(`${PAYOPS_MOCK_URL}/_mock/reset`, { method: 'POST' });
  await fetch(`${PAYOPS_MOCK_URL}/_mock/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asyncProcessing: true, webhookMode: 'drop' }),
  });

  const { token, item } = await createUserAndItem();
  const createRes = await fetch(`${ORDER_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [item],
      card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
    }),
  });
  const { order } = await createRes.json();
  assert.equal(order.status, 'PENDING_PAYMENT');

  // Wait > 10s so reconciliation eligibility window passes and mock async processing completes
  await new Promise((r) => setTimeout(r, 11000));
  await fetch(`${ORDER_URL}/api/orders/reconcile`, { method: 'POST' });

  const check = await (await fetch(`${ORDER_URL}/api/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  assert.equal(check.order.status, 'PAID');
});

test('Scenario 4: PayOps down (HTTP 503) keeps order in PENDING_PAYMENT', async () => {
  await fetch(`${PAYOPS_MOCK_URL}/_mock/reset`, { method: 'POST' });
  await fetch(`${PAYOPS_MOCK_URL}/_mock/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceHttpStatus: 503 }),
  });

  const { token, item } = await createUserAndItem();
  const createRes = await fetch(`${ORDER_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [item],
      card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
    }),
  });
  assert.equal(createRes.status, 201);
  const { order } = await createRes.json();
  assert.equal(order.status, 'PENDING_PAYMENT');
  await fetch(`${PAYOPS_MOCK_URL}/_mock/reset`, { method: 'POST' });
});

test('Scenario 5: Declined card transitions order to PAYMENT_FAILED and never PAID', async () => {
  await fetch(`${PAYOPS_MOCK_URL}/_mock/reset`, { method: 'POST' });
  const { token, item } = await createUserAndItem();
  const createRes = await fetch(`${ORDER_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [item],
      card: { number: '4000000000000002', cvv: '424', exp_month: '12', exp_year: '2029' },
    }),
  });
  const { order } = await createRes.json();
  assert.equal(order.status, 'PAYMENT_FAILED');
});
