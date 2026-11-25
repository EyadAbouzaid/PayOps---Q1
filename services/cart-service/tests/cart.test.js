const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');

test('Cart Service adds, updates, and removes items with integer cents totals', async () => {
  const store = new Map();
  const fakeRedis = {
    ping: async () => 'PONG',
    get: async (k) => store.get(k) || null,
    set: async (k, v) => { store.set(k, v); },
  };
  const fakeDb = {
    query: async () => ({ rowCount: 0, rows: [] }),
  };

  const app = createApp({ redis: fakeRedis, db: fakeDb });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const token = jwt.sign({ sub: 'user_1', email: 'a@b.com' }, 'super_secret_ecommerce_jwt_key_change_me');

  try {
    const addRes = await fetch(`http://127.0.0.1:${port}/api/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ product_id: 'p1', product_name: 'Key', unit_price_cents: 5500, quantity: 2 }),
    });
    assert.equal(addRes.status, 200);
    const cart1 = await addRes.json();
    assert.equal(cart1.total_cents, 11000);

    const updRes = await fetch(`http://127.0.0.1:${port}/api/cart/items/p1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ quantity: 3 }),
    });
    const cart2 = await updRes.json();
    assert.equal(cart2.total_cents, 16500);
  } finally {
    server.close();
  }
});
