const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const client = require('prom-client');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_ecommerce_jwt_key_change_me';

function createApp({ redis, db }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'cart-service' }));
  app.get('/ready', async (_req, res) => {
    try {
      await redis.ping();
      await db.query('SELECT 1');
      res.status(200).json({ status: 'ready', service: 'cart-service' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  function requireUserAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Missing JWT token' } });
    }
    try {
      req.user = jwt.verify(auth.slice(7), JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: { code: 'invalid_token', message: 'Invalid JWT token' } });
    }
  }

  async function getCartItems(userId) {
    const key = `cart:${userId}`;
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const dbRes = await db.query('SELECT items FROM carts WHERE user_id = $1', [userId]);
    const items = dbRes.rowCount > 0 ? dbRes.rows[0].items : [];
    await redis.set(key, JSON.stringify(items), { EX: 86400 });
    return items;
  }

  async function saveCartItems(userId, items) {
    const key = `cart:${userId}`;
    await redis.set(key, JSON.stringify(items), { EX: 86400 });
    await db.query(
      `INSERT INTO carts (user_id, items, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET items = $2::jsonb, updated_at = NOW()`,
      [userId, JSON.stringify(items)]
    );
  }

  function formatCartResponse(userId, items) {
    const total_cents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
    return { user_id: userId, items, total_cents };
  }

  app.get('/api/cart', requireUserAuth, async (req, res) => {
    const items = await getCartItems(req.user.sub);
    res.json(formatCartResponse(req.user.sub, items));
  });

  app.post('/api/cart/items', requireUserAuth, async (req, res) => {
    const { product_id, product_name, unit_price_cents, quantity = 1 } = req.body || {};
    const qty = parseInt(quantity, 10);
    const price = parseInt(unit_price_cents, 10);
    if (!product_id || !product_name || !Number.isInteger(qty) || qty <= 0 || !Number.isInteger(price) || price <= 0) {
      return res.status(400).json({ error: { code: 'invalid_item', message: 'Valid product_id, product_name, unit_price_cents, and quantity required' } });
    }

    const items = await getCartItems(req.user.sub);
    const existing = items.find((i) => i.product_id === product_id);
    if (existing) {
      existing.quantity += qty;
      existing.unit_price_cents = price;
    } else {
      items.push({ product_id, product_name, unit_price_cents: price, quantity: qty });
    }

    await saveCartItems(req.user.sub, items);
    res.status(200).json(formatCartResponse(req.user.sub, items));
  });

  app.put('/api/cart/items/:productId', requireUserAuth, async (req, res) => {
    const qty = parseInt(req.body?.quantity, 10);
    if (!Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: { code: 'invalid_quantity', message: 'quantity must be >= 0' } });
    }

    let items = await getCartItems(req.user.sub);
    if (qty === 0) {
      items = items.filter((i) => i.product_id !== req.params.productId);
    } else {
      const target = items.find((i) => i.product_id === req.params.productId);
      if (!target) {
        return res.status(404).json({ error: { code: 'not_found', message: 'Item not in cart' } });
      }
      target.quantity = qty;
    }

    await saveCartItems(req.user.sub, items);
    res.json(formatCartResponse(req.user.sub, items));
  });

  app.delete('/api/cart/items/:productId', requireUserAuth, async (req, res) => {
    const items = (await getCartItems(req.user.sub)).filter((i) => i.product_id !== req.params.productId);
    await saveCartItems(req.user.sub, items);
    res.json(formatCartResponse(req.user.sub, items));
  });

  app.delete('/api/cart', requireUserAuth, async (req, res) => {
    await saveCartItems(req.user.sub, []);
    res.json(formatCartResponse(req.user.sub, []));
  });

  return app;
}

module.exports = { createApp };
