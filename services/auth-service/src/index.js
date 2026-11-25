const { Pool } = require('pg');
const { createApp, seedDemoUser } = require('./app');

const PORT = parseInt(process.env.PORT || '4004', 10);
const HOST = process.env.HOST || '0.0.0.0';
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const app = createApp({ db });

async function start() {
  try {
    await seedDemoUser(db);
  } catch (err) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), service: 'auth-service', level: 'error', message: 'Failed to seed demo user on startup', error: err.message }));
  }

  app.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'auth-service', level: 'info', message: `Listening on ${HOST}:${PORT}` }));
  });
}

start();
