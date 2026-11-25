const express = require('express');
const cors = require('cors');
const client = require('prom-client');

function createApp({ db }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'product-service' }));
  app.get('/ready', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.status(200).json({ status: 'ready', service: 'product-service' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Categories CRUD
  app.get('/api/categories', async (_req, res) => {
    const result = await db.query('SELECT * FROM categories ORDER BY name ASC');
    res.json({ categories: result.rows });
  });

  app.post('/api/categories', async (req, res) => {
    const { name, slug, description = '' } = req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'name and slug are required' } });
    }
    try {
      const result = await db.query(
        'INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *',
        [name, slug, description]
      );
      res.status(201).json({ category: result.rows[0] });
    } catch (err) {
      res.status(409).json({ error: { code: 'conflict', message: err.message } });
    }
  });

  // Products CRUD (integer cents, no currency column per rule 11)
  app.get('/api/products', async (req, res) => {
    const { category_id } = req.query;
    if (category_id) {
      const result = await db.query(
        `SELECT p.*, c.name AS category_name
         FROM products p LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.category_id = $1 ORDER BY p.created_at DESC`,
        [category_id]
      );
      return res.json({ products: result.rows });
    }
    const result = await db.query(
      `SELECT p.*, c.name AS category_name
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.created_at DESC`
    );
    return res.json({ products: result.rows });
  });

  app.get('/api/products/:id', async (req, res) => {
    const result = await db.query(
      `SELECT p.*, c.name AS category_name
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Product not found' } });
    }
    res.json({ product: result.rows[0] });
  });

  app.post('/api/products', async (req, res) => {
    const { name, description = '', price_cents, stock_quantity = 0, category_id = null, image_url = null } = req.body || {};
    if (!name || !Number.isInteger(price_cents) || price_cents <= 0) {
      return res.status(400).json({
        error: { code: 'invalid_product', message: 'name and positive integer price_cents are required' },
      });
    }
    const result = await db.query(
      `INSERT INTO products (name, description, price_cents, stock_quantity, category_id, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description, price_cents, Math.max(0, parseInt(stock_quantity, 10) || 0), category_id, image_url]
    );
    res.status(201).json({ product: result.rows[0] });
  });

  app.put('/api/products/:id', async (req, res) => {
    const { name, description, price_cents, stock_quantity, category_id, image_url } = req.body || {};
    if (price_cents !== undefined && (!Number.isInteger(price_cents) || price_cents <= 0)) {
      return res.status(400).json({ error: { code: 'invalid_price', message: 'price_cents must be a positive integer' } });
    }
    const result = await db.query(
      `UPDATE products
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price_cents = COALESCE($3, price_cents),
           stock_quantity = COALESCE($4, stock_quantity),
           category_id = COALESCE($5, category_id),
           image_url = COALESCE($6, image_url),
           updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name ?? null, description ?? null, price_cents ?? null, stock_quantity ?? null, category_id ?? null, image_url ?? null, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Product not found' } });
    }
    res.json({ product: result.rows[0] });
  });

  app.patch('/api/products/:id/inventory', async (req, res) => {
    const { delta } = req.body || {};
    if (!Number.isInteger(delta)) {
      return res.status(400).json({ error: { code: 'invalid_delta', message: 'delta must be an integer' } });
    }
    const result = await db.query(
      `UPDATE products
       SET stock_quantity = stock_quantity + $1, updated_at = NOW()
       WHERE id = $2 AND stock_quantity + $1 >= 0
       RETURNING *`,
      [delta, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: { code: 'insufficient_stock_or_not_found', message: 'Cannot update inventory' } });
    }
    res.json({ product: result.rows[0] });
  });

  app.delete('/api/products/:id', async (req, res) => {
    const result = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Product not found' } });
    }
    res.status(204).send();
  });

  return app;
}

module.exports = { createApp };
