const { Pool } = require('pg');
const { createClient } = require('redis');
const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '4003', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', (err) => console.error('Redis error', err));
  await redis.connect();

  const app = createApp({ redis, db });
  app.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'cart-service', level: 'info', message: `Listening on ${HOST}:${PORT}` }));
  });
}

main();
