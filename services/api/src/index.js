const path = require('path');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const config = require('../../../shared/config');
const db = require('../../../shared/db');
const { register } = require('../../../shared/metrics');
const { createLogger } = require('../../../shared/logger');
const { attachRequestContext } = require('./middleware/context');

const telemetryRoutes = require('./features/telemetry/routes');
const paymentsRoutes = require('./features/payments/routes');
const invoicesRoutes = require('./features/invoices/routes');
const billingRoutes = require('./features/billing/routes');
const webhooksRoutes = require('./features/webhooks/routes');
const openApiSpec = require('./features/docs/openapi');

const log = createLogger('api-gateway');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestContext);

  // 1. Live Telemetry & Root Health (/status, /health)
  app.use('/', telemetryRoutes);

  // 2. Prometheus Metrics (/metrics)
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // 3. Interactive OpenAPI Developer Sandbox (/api-docs)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'PayOps API Sandbox'
  }));
  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));

  // 4. Decoupled Feature Micro-Routes (Each with isolated /health and logs)
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/webhooks', webhooksRoutes);

  // 5. Optional Static Frontend Hosting (keeps single Port 3000 ALB target working seamlessly)
  if (config.serveStaticFrontend) {
    const publicDir = path.join(process.cwd(), 'services', 'frontend', 'public');
    app.use(express.static(publicDir));
  }

  // Centralized Error Handler with Trace ID for fast CloudWatch troubleshooting
  app.use((err, req, res, _next) => {
    log.error('Unhandled API route exception', {
      traceId: req.traceId,
      path: req.path,
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Internal server error', traceId: req.traceId });
  });

  return app;
}

async function startApiServer() {
  if (config.db.autoMigrate) {
    await db.runMigrationsAndSeed();
  }
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(config.port, '0.0.0.0', () => {
      log.info(`PayOps API listening on port ${config.port}`, {
        port: config.port,
        defaultMode: config.defaultMode,
        queueDriver: config.queue.driver
      });
      resolve(server);
    });

    // Zero-downtime graceful shutdown on ECS SIGTERM
    process.on('SIGTERM', () => {
      log.info('SIGTERM received: draining active HTTP connections gracefully');
      server.close(() => {
        db.pool.end(() => process.exit(0));
      });
    });
  });
}

if (require.main === module) {
  require('dotenv').config();
  startApiServer().catch((err) => {
    log.error('API startup failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = { createApp, startApiServer };
