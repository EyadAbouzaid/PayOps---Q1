const express = require('express');
const config = require('../../../../../shared/config');
const db = require('../../../../../shared/db');
const queue = require('../../../../../shared/queue');
const { createLogger } = require('../../../../../shared/logger');

const router = express.Router();
const log = createLogger('telemetry');

let cachedAz = null;

async function resolveAwsAvailabilityZone() {
  if (cachedAz) return cachedAz;
  if (process.env.AWS_AVAILABILITY_ZONE) {
    cachedAz = process.env.AWS_AVAILABILITY_ZONE;
    return cachedAz;
  }
  const metaUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!metaUri) {
    cachedAz = `${config.awsRegion}-local`;
    return cachedAz;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${metaUri}/task`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      cachedAz = data.AvailabilityZone || `${config.awsRegion}-ecs`;
      return cachedAz;
    }
  } catch (_) {
    // Non-ECS environment fallback
  }
  cachedAz = `${config.awsRegion}-fargate`;
  return cachedAz;
}

// ALB Target Group Health Probe (GET /health)
router.get('/health', async (req, res) => {
  try {
    const dbLatencyMs = await db.pingDatabase();
    const queueHealth = await queue.getQueueHealth();
    res.status(200).json({
      status: 'healthy',
      service: config.serviceName,
      timestamp: new Date().toISOString(),
      checks: {
        database: { healthy: true, latencyMs: dbLatencyMs },
        queue: queueHealth
      }
    });
  } catch (err) {
    log.error('Root /health probe failed', { error: err.message, traceId: req.traceId });
    res.status(503).json({
      status: 'unhealthy',
      service: config.serviceName,
      error: err.message
    });
  }
});

// Live Infrastructure Telemetry Endpoint (GET /status)
router.get('/status', async (req, res) => {
  let rdsLatencyMs = null;
  let dbHealthy = false;
  try {
    rdsLatencyMs = await db.pingDatabase();
    dbHealthy = true;
  } catch (err) {
    log.warn('Telemetry RDS ping degraded', { error: err.message });
  }

  const [availabilityZone, queueHealth] = await Promise.all([
    resolveAwsAvailabilityZone(),
    queue.getQueueHealth()
  ]);

  res.json({
    platform: 'PayOps High-Reliability Payment & Billing Engine',
    status: dbHealthy ? 'operational' : 'degraded',
    hostname: config.hostname,
    region: config.awsRegion,
    availabilityZone,
    gitCommitSha: config.gitCommitSha,
    jenkinsBuildNumber: config.jenkinsBuildNumber,
    uptimeSeconds: Math.floor(process.uptime()),
    activeMode: req.envMode,
    rds: {
      healthy: dbHealthy,
      pingLatencyMs: rdsLatencyMs,
      sslEnabled: config.db.ssl
    },
    queue: queueHealth,
    storageDriver: config.storage.s3Bucket ? 's3' : 'local-fallback',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
