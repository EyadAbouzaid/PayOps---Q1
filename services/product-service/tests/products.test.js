const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');

test('Product Service enforces integer cents and supports CRUD', async () => {
  const fakeDb = {
    query: async (sql, params) => {
      if (sql === 'SELECT 1') return { rows: [{}] };
      if (sql.startsWith('INSERT INTO products')) {
        return { rowCount: 1, rows: [{ id: 'prod_1', name: params[0], price_cents: params[2], stock_quantity: params[3] }] };
      }
      if (sql.includes('FROM products p')) {
        return { rowCount: 1, rows: [{ id: 'prod_1', name: 'Test Item', price_cents: 5000 }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const app = createApp({ db: fakeDb });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    // Reject float price_cents
    const badRes = await fetch(`http://127.0.0.1:${port}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', price_cents: 19.99 }),
    });
    assert.equal(badRes.status, 400);

    const okRes = await fetch(`http://127.0.0.1:${port}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Good', price_cents: 1999, stock_quantity: 5 }),
    });
    assert.equal(okRes.status, 201);
  } finally {
    server.close();
  }
});
