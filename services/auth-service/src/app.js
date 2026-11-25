const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const client = require('prom-client');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_ecommerce_jwt_key_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

function log(level, message, meta = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'auth-service', level, message, ...meta }));
}

function createApp({ db }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'auth-service' }));
  app.get('/ready', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.status(200).json({ status: 'ready', service: 'auth-service' });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: err.message });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, full_name } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'email, password, and full_name are required' } });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (String(password).length < 6) {
      return res.status(400).json({ error: { code: 'weak_password', message: 'Password must be at least 6 characters' } });
    }

    try {
      const hash = await bcrypt.hash(String(password), 10);
      const result = await db.query(
        'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name, created_at',
        [normalizedEmail, hash, String(full_name).trim()]
      );
      const user = result.rows[0];
      const token = jwt.sign({ sub: user.id, email: user.email, name: user.full_name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      log('info', 'User registered', { user_id: user.id, email: user.email });
      return res.status(201).json({ user, token });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: { code: 'email_exists', message: 'Email already registered' } });
      }
      log('error', 'Register failed', { error: err.message });
      return res.status(500).json({ error: { code: 'internal_error', message: 'Registration failed' } });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'email and password are required' } });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
    }

    const token = jwt.sign({ sub: user.id, email: user.email, name: user.full_name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    log('info', 'User logged in', { user_id: user.id });
    return res.status(200).json({
      user: { id: user.id, email: user.email, full_name: user.full_name },
      token,
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Missing JWT' } });
    }
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      return res.json({ user: { id: payload.sub, email: payload.email, full_name: payload.name } });
    } catch {
      return res.status(401).json({ error: { code: 'invalid_token', message: 'Invalid JWT' } });
    }
  });

  return app;
}

module.exports = { createApp };
