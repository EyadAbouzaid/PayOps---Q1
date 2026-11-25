const express = require('express');
const cors = require('cors');
const client = require('prom-client');

function createApp({ db }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'search-service' }));
  app.get('/ready', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.status(200).json({ status: 'ready', service: 'search-service' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Search by name/query and category using PostgreSQL full-text search + ILIKE fallback
  app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();

    const conditions = [];
    const params = [];

    if (q) {
      params.push(q);
      const qIdx = params.length;
      params.push(`%${q}%`);
      const likeIdx = params.length;
      conditions.push(`(p.search_vector @@ plainto_tsquery('english', $${qIdx}) OR p.name ILIKE $${likeIdx})`);
    }

    if (category) {
      params.push(category);
      const catIdx = params.length;
      conditions.push(`(c.slug = $${catIdx} OR c.id::text = $${catIdx} OR c.name ILIKE $${catIdx})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT p.id, p.category_id, p.name, p.description, p.price_cents, p.stock_quantity, p.image_url,
             c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT 50
    `;

    const result = await db.query(sql, params);
    res.json({ query: q, category, count: result.rowCount, results: result.rows });
  });

  return app;
}

module.exports = { createApp };
