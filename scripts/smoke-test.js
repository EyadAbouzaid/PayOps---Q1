/**
 * Integration Smoke Script (Rule 12 & Deliverable Order):
 * login -> add to cart -> create order -> pay -> poll the order until PAID (max 30s)
 * -> assert payment_intent_id exists and currency is USD.
 */
const assert = require('node:assert/strict');

const AUTH_URL = process.env.AUTH_URL || 'http://localhost:4004';
const PRODUCT_URL = process.env.PRODUCT_URL || 'http://localhost:4002';
const CART_URL = process.env.CART_URL || 'http://localhost:4003';
const ORDER_URL = process.env.ORDER_URL || 'http://localhost:4001';

async function main() {
  const email = `smoke_${Date.now()}@ecommerce.io`;
  const password = 'Password123!';

  // 1. Register & Login
  const regRes = await fetch(`${AUTH_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name: 'Smoke Tester' }),
  });
  assert.equal(regRes.status, 201, 'Register should succeed');

  const loginRes = await fetch(`${AUTH_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, 'Login should succeed');
  const { token } = await loginRes.json();
  assert.ok(token, 'JWT token must be returned');

  // 2. Fetch Product & Add to Cart
  const prodRes = await fetch(`${PRODUCT_URL}/api/products`);
  assert.equal(prodRes.status, 200);
  const { products } = await prodRes.json();
  assert.ok(products.length > 0, 'Seeded products should exist');
  const product = products[0];

  const cartRes = await fetch(`${CART_URL}/api/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      product_id: product.id,
      product_name: product.name,
      unit_price_cents: product.price_cents,
      quantity: 1,
    }),
  });
  assert.equal(cartRes.status, 200, 'Add to cart should succeed');

  // 3. Create Order & Pay via PayOps
  const createOrderRes = await fetch(`${ORDER_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [{
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: 1,
      }],
      card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
    }),
  });
  assert.equal(createOrderRes.status, 201, 'Create order should return 201');
  const { order: createdOrder } = await createOrderRes.json();

  // 4. Poll Order until PAID (max 30s)
  const deadline = Date.now() + 30000;
  let finalOrder = createdOrder;
  while (Date.now() < deadline && finalOrder.status !== 'PAID') {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(`${ORDER_URL}/api/orders/${createdOrder.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pollData = await pollRes.json();
    finalOrder = pollData.order;
  }

  assert.equal(finalOrder.status, 'PAID', `Expected PAID status, got ${finalOrder.status}`);
  assert.ok(finalOrder.payment_intent_id, 'payment_intent_id must exist');
  assert.equal(finalOrder.currency, 'USD', 'currency must be USD');

  console.log(JSON.stringify({
    smoke_test: 'PASSED',
    order_id: finalOrder.id,
    payment_intent_id: finalOrder.payment_intent_id,
    status: finalOrder.status,
    currency: finalOrder.currency,
  }));
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err);
  process.exit(1);
});
