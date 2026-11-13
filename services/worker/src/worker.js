require('dotenv').config();
const http = require('http');
const queue = require('../../../shared/queue');
const db = require('../../../shared/db');
const config = require('../../../shared/config');
const { createLogger } = require('../../../shared/logger');

const { handleInvoiceGenerate } = require('./handlers/invoiceHandler');
const { handleWebhookDispatch, handleWebhookReplay } = require('./handlers/webhookHandler');
const { handleBillingScheduleExecute } = require('./handlers/billingHandler');

const log = createLogger('worker-core');
let running = true;

async function processSingleJob(job) {
  if (!job) return;
  log.info('Processing background job', { jobId: job.id, jobType: job.type });

  switch (job.type) {
    case 'invoice.generate':
      await handleInvoiceGenerate(job.payload);
      break;
    case 'webhook.dispatch_event':
      await handleWebhookDispatch(job.payload);
      break;
    case 'webhook.replay':
      await handleWebhookReplay(job.payload);
      break;
    case 'billing.execute_schedule':
      await handleBillingScheduleExecute(job.payload);
      break;
    default:
      log.warn('Unknown job type ignored', { jobType: job.type });
  }
}

async function startWorkerLoop() {
  log.info('Async worker loop started', { queueDriver: config.queue.driver });
  queue.onMemoryJob(async () => {
    const job = await queue.dequeueJob(0);
    if (job) await processSingleJob(job);
  });

  while (running) {
    try {
      const job = await queue.dequeueJob(2);
      if (job) {
        await processSingleJob(job);
      } else if (config.queue.driver === 'memory') {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      log.error('Worker loop error', { error: err.message });
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

if (require.main === module) {
  // Lightweight health probe for standalone ECS/K8s worker container on port 3001
  const workerPort = parseInt(process.env.WORKER_HEALTH_PORT || '3001', 10);
  http.createServer(async (req, res) => {
    if (req.url === '/health') {
      try {
        await db.pingDatabase();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'payops-worker', status: 'healthy' }));
      } catch (e) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: 'payops-worker', status: 'unhealthy', error: e.message }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  }).listen(workerPort, '0.0.0.0');

  process.on('SIGTERM', () => {
    running = false;
    log.info('Worker received SIGTERM, shutting down cleanly');
    setTimeout(() => process.exit(0), 1000);
  });

  startWorkerLoop();
}

module.exports = { startWorkerLoop, processSingleJob };
