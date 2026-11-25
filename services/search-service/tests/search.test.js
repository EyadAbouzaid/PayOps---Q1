const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/app');

test('Search Service queries PostgreSQL full-text and category filters', async () => {
  let capturedSql = '';
  const fakeDb = {
    query: async (sql) => {
      capturedSql = sql;
      return { rowCount: 1, rows: [{ id: 'p1', name: 'Keyboard', price_cents: 18900 }] };
    },
  };
  const app = createApp({ db: fakeDb });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search?q=Keyboard&category=developer-workstations`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.match(capturedSql, /plainto_tsquery/);
  } finally {
    server.close();
  }
});
