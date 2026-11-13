const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');
const { createLogger } = require('./logger');

const log = createLogger('database');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  log.error('Unexpected PostgreSQL pool error', { error: err.message });
});

async function pingDatabase() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - start;
}

async function runMigrationsAndSeed() {
  const initSqlPath = path.join(process.cwd(), 'db', 'init.sql');
  const seedSqlPath = path.join(process.cwd(), 'db', 'seed.sql');

  if (fs.existsSync(initSqlPath)) {
    const initSql = fs.readFileSync(initSqlPath, 'utf8');
    await pool.query(initSql);
    log.info('Database schema verified/initialized from db/init.sql');
  }
  if (fs.existsSync(seedSqlPath)) {
    const seedSql = fs.readFileSync(seedSqlPath, 'utf8');
    await pool.query(seedSql);
    log.info('Database sandbox seed data verified from db/seed.sql');
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  pingDatabase,
  runMigrationsAndSeed
};
