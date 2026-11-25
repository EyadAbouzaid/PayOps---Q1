const { Pool } = require('pg');
const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '4004', 10);
const HOST = process.env.HOST || '0.0.0.0';
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const app = createApp({ db });
app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'auth-service', level: 'info', message: `Listening on ${HOST}:${PORT}` }));
});
