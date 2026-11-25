const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../src/config');
const { createApp } = require('../src/app');

function makeToken(userId = 'user_1', email = 'test@store.io') {
  return jwt.sign({ sub: userId, email, name: 'Test User' }, JWT_SECRET, { expiresIn: '1h' });
}

function createFakeDb() {
  const orders = [];
  const orderItems = [];
  const webhookEvents = [];
  let nextOrderIdx = 0;

  return {
    query: async (sql, params = []) => {
      // INSERT INTO orders
      if (sql.includes('INSERT INTO orders')) {
        const id = `order_${++nextOrderIdx}`;
        const order = {
          id,
          user_id: params[0],
          customer_email: params[1],
          status: 'PENDING_PAYMENT',
          total_amount_cents: params[2],
          currency: params[3],
          payment_intent_id: null,
          failure_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        orders.push(order);
        return { rowCount: 1, rows: [order] };
      }
      // INSERT INTO order_items
      if (sql.includes('INSERT INTO order_items')) {
        orderItems.push({ order_id: params[0], product_id: params[1], product_name: params[2], quantity: params[3], unit_price_cents: params[4] });
        return { rowCount: 1, rows: [] };
      }
      // SELECT orders by id and user
      if (sql.includes('SELECT * FROM orders WHERE id') && sql.includes('user_id')) {
        const found = orders.filter((o) => o.id === params[0] && o.user_id === params[1]);
        return { rowCount: found.length, rows: found };
      }
      // SELECT orders by user
      if (sql.includes('SELECT * FROM orders WHERE user_id')) {
        const found = orders.filter((o) => o.user_id === params[0]);
        return { rowCount: found.length, rows: found };
      }
      // SELECT order_items
      if (sql.includes('SELECT * FROM order_items WHERE order_id')) {
        const found = orderItems.filter((i) => i.order_id === params[0]);
        return { rowCount: found.length, rows: found };
      }
      // UPDATE orders SET payment_intent_id
      if (sql.includes('UPDATE orders') && sql.includes('payment_intent_id')) {
        const order = orders.find((o) => o.id === (params[3] || params[4]));
        if (order) {
          if (params[0] !== undefined) order.payment_intent_id = params[0] || order.payment_intent_id;
          if (params[1] !== undefined) order.status = params[1];
          if (params[2] !== undefined) order.failure_reason = params[2];
          order.updated_at = new Date().toISOString();
        }
        return { rowCount: order ? 1 : 0, rows: order ? [order] : [] };
      }
      // UPDATE orders SET status
      if (sql.includes('UPDATE orders SET status')) {
        const order = orders.find((o) => o.id === params[1]);
        if (order) {
          order.status = params[0];
          order.updated_at = new Date().toISOString();
        }
        return { rowCount: order ? 1 : 0, rows: order ? [order] : [] };
      }
      // SELECT 1 for readiness
      if (sql === 'SELECT 1') {
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }
      return { rowCount: 0, rows: [] };
    },
    getClient: async () => {
      const fakeClient = {
        query: async (sql, params) => {
          // Forward to the main db.query but handle BEGIN/COMMIT/ROLLBACK
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rowCount: 0, rows: [] };
          }
          return fakeClient._parent.query(sql, params);
        },
        release: () => {},
      };
      fakeClient._parent = { query: async (sql, params) => createFakeDb.prototype._shared.query(sql, params) };
      // Use closure to share state
      fakeClient._parent.query = async (sql, params) => {
        // Re-use the same query logic from the outer db
        if (sql.includes('INSERT INTO orders')) {
          const id = `order_${++nextOrderIdx}`;
          const order = {
            id,
            user_id: params[0],
            customer_email: params[1],
            status: 'PENDING_PAYMENT',
            total_amount_cents: params[2],
            currency: params[3],
            payment_intent_id: null,
            failure_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          orders.push(order);
          return { rowCount: 1, rows: [order] };
        }
        if (sql.includes('INSERT INTO order_items')) {
          orderItems.push({ order_id: params[0], product_id: params[1], product_name: params[2], quantity: params[3], unit_price_cents: params[4] });
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      };
      return fakeClient;
    },
  };
}

function createFakePaymentClient() {
  return {
    createPayment: async (order) => ({
      intentId: `pi_${order.id}`,
      rawStatus: 'succeeded',
      orderStatus: 'PAID',
      amountCents: order.total_amount_cents,
      currency: 'USD',
      failureReason: null,
    }),
    getPayment: async (intentId) => ({
      intentId,
      rawStatus: 'succeeded',
      orderStatus: 'PAID',
      amountCents: 10000,
      currency: 'USD',
      failureReason: null,
    }),
    refund: async () => ({ refundId: 'ref_1', status: 'succeeded' }),
    tokenize: async () => ({ vaultToken: 'vault_tok_test_1' }),
  };
}

test('Order API: POST /api/orders creates order and returns 201', async () => {
  const db = createFakeDb();
  const paymentClient = createFakePaymentClient();
  const app = createApp({ db, paymentClient });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const token = makeToken();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: [{ product_id: 'p1', product_name: 'Widget', unit_price_cents: 5000, quantity: 2 }],
        card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.order);
    assert.equal(data.order.total_amount_cents, 10000);
    assert.equal(data.order.currency, 'USD');
  } finally {
    server.close();
  }
});

test('Order API: POST /api/orders rejects empty items with 400', async () => {
  const db = createFakeDb();
  const app = createApp({ db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const token = makeToken();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'empty_items');
  } finally {
    server.close();
  }
});

test('Order API: GET /api/orders returns user orders', async () => {
  const db = createFakeDb();
  const app = createApp({ db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const token = makeToken();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.orders));
  } finally {
    server.close();
  }
});

test('Order API: GET /api/orders/:id returns 404 for non-existent order', async () => {
  const db = createFakeDb();
  const app = createApp({ db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const token = makeToken();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders/nonexistent`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('Order API: requires JWT auth and returns 401 without it', async () => {
  const db = createFakeDb();
  const app = createApp({ db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/orders`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('Order API: health and ready endpoints respond 200', async () => {
  const db = createFakeDb();
  const app = createApp({ db });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 200);
  } finally {
    server.close();
  }
});
