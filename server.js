/**
 * Root Entrypoint (Backward-compatible with original MohamedTantawey/PayOps deployment)
 * Boots the modular API server (and optional embedded async worker if ENABLE_EMBEDDED_WORKER=true).
 */
require('dotenv').config();
const { startApiServer } = require('./services/api/src/index');
const { startWorkerLoop } = require('./services/worker/src/worker');
const { createLogger } = require('./shared/logger');

const log = createLogger('bootstrap');

(async () => {
  try {
    await startApiServer();
    if (String(process.env.ENABLE_EMBEDDED_WORKER).toLowerCase() === 'true') {
      log.info('Starting embedded background worker in same container process');
      startWorkerLoop();
    }
  } catch (err) {
    log.error('Fatal startup failure', { error: err.message, stack: err.stack });
    process.exit(1);
  }
})();
