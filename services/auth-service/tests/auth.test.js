const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');

test('Auth Service register and login flow', async () => {
  const users = new Map();
  const fakeDb = {
    query: async (sql, params) => {
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (sql.startsWith('INSERT INTO users')) {
        const [email, password_hash, full_name] = params;
        if (users.has(email)) {
          const e = new Error('dup');
          e.code = '23505';
          throw e;
        }
        const row = { id: 'u_123', email, password_hash, full_name, created_at: new Date().toISOString() };
        users.set(email, row);
        return { rowCount: 1, rows: [row] };
      }
      if (sql.startsWith('SELECT * FROM users WHERE email')) {
        const row = users.get(params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const app = createApp({ db: fakeDb });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@test.io', password: 'password123', full_name: 'Test Buyer' }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.token);

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@test.io', password: 'password123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
  } finally {
    server.close();
  }
});
