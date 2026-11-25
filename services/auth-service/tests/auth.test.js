const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp, seedDemoUser } = require('../src/app');

function createFakeDb() {
  const users = new Map();
  let seq = 1;
  return {
    users,
    query: async (sql, params) => {
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (sql.startsWith('INSERT INTO users')) {
        const [email, password_hash, full_name] = params;
        if (users.has(email)) {
          if (sql.includes('ON CONFLICT')) {
            return { rowCount: 0, rows: [] };
          }
          const e = new Error('dup');
          e.code = '23505';
          throw e;
        }
        const row = { id: `u_${seq++}`, email, password_hash, full_name, created_at: new Date().toISOString() };
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
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('Auth Service register and login flow (AUTO_REGISTER_ON_LOGIN disabled by default)', async () => {
  const fakeDb = createFakeDb();
  const app = createApp({ db: fakeDb });

  await withServer(app, async (baseUrl) => {
    const unknownRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@test.io', password: 'password123' }),
    });
    assert.equal(unknownRes.status, 401);

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Buyer@Test.IO ', password: 'password123', full_name: 'Test Buyer' }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.token);
    assert.equal(regData.user.email, 'buyer@test.io');

    const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'buyer@test.io', password: 'wrongpassword' }),
    });
    assert.equal(badPassRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ' BUYER@test.io ', password: 'password123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
    assert.equal(loginData.user.email, 'buyer@test.io');
  });
});

test('Auth Service AUTO_REGISTER_ON_LOGIN=true auto-registers new emails and enforces passwords for existing users', async () => {
  const fakeDb = createFakeDb();
  const app = createApp({ db: fakeDb, autoRegisterOnLogin: true });

  await withServer(app, async (baseUrl) => {
    const firstLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  New.Tester+1@Example.COM ', password: 'mypassword' }),
    });
    assert.equal(firstLogin.status, 200);
    const firstData = await firstLogin.json();
    assert.ok(firstData.token);
    assert.equal(firstData.user.email, 'new.tester+1@example.com');

    const wrongPassLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new.tester+1@example.com', password: 'wrongpassword' }),
    });
    assert.equal(wrongPassLogin.status, 401);

    const validRepeatLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new.tester+1@example.com', password: 'mypassword' }),
    });
    assert.equal(validRepeatLogin.status, 200);
    const repeatData = await validRepeatLogin.json();
    assert.ok(repeatData.token);
  });
});

test('seedDemoUser idempotently seeds demo@cloudops.com', async () => {
  const fakeDb = createFakeDb();
  await seedDemoUser(fakeDb);
  await seedDemoUser(fakeDb);
  assert.equal(fakeDb.users.size, 1);
  assert.ok(fakeDb.users.has('demo@cloudops.com'));

  const app = createApp({ db: fakeDb });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@cloudops.com', password: 'password123' }),
    });
    assert.equal(res.status, 200);
  });
});
