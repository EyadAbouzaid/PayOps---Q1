const express = require('express');
const path = require('path');
const client = require('prom-client');

const PORT = parseInt(process.env.PORT || '5173', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'frontend' }));
app.get('/ready', (_req, res) => res.status(200).json({ status: 'ready', service: 'frontend' }));
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Runtime env injection for browser
app.get('/env.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.__ENV__ = ${JSON.stringify({
    AUTH_API_URL: process.env.VITE_AUTH_API_URL || 'http://localhost:4004',
    PRODUCT_API_URL: process.env.VITE_PRODUCT_API_URL || 'http://localhost:4002',
    SEARCH_API_URL: process.env.VITE_SEARCH_API_URL || 'http://localhost:4005',
    CART_API_URL: process.env.VITE_CART_API_URL || 'http://localhost:4003',
    ORDER_API_URL: process.env.VITE_ORDER_API_URL || 'http://localhost:4001',
  })};`);
});

const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'frontend', level: 'info', message: `Frontend listening on ${HOST}:${PORT}` }));
});
