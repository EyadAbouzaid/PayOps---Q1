const crypto = require('crypto');
const config = require('./config');
const { createLogger } = require('./logger');

const log = createLogger('queue');

let redisClient = null;
let sqsClient = null;
let sqsCommands = null;
const memoryQueue = [];
const localListeners = [];

function getRedis() {
  if (!redisClient) {
    const Redis = require('ioredis');
    redisClient = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false
    });
    redisClient.on('error', (err) => {
      log.warn('Redis connection issue', { error: err.message });
    });
  }
  return redisClient;
}

function getSqs() {
  if (!sqsClient) {
    const sqsPkg = require('@aws-sdk/client-sqs');
    sqsClient = new sqsPkg.SQSClient({ region: config.awsRegion });
    sqsCommands = sqsPkg;
  }
  return { sqsClient, sqsCommands };
}

/**
 * Enqueue async background job (invoice.generate | webhook.deliver | billing.execute)
 */
async function enqueueJob(type, payload, meta = {}) {
  const job = {
    id: crypto.randomUUID(),
    type,
    payload,
    attempts: meta.attempts || 0,
    createdAt: new Date().toISOString()
  };

  const driver = config.queue.driver;
  try {
    if (driver === 'redis') {
      await getRedis().rpush(config.queue.queueKey, JSON.stringify(job));
    } else if (driver === 'sqs' && config.queue.sqsQueueUrl) {
      const { sqsClient: client, sqsCommands: cmds } = getSqs();
      await client.send(new cmds.SendMessageCommand({
        QueueUrl: config.queue.sqsQueueUrl,
        MessageBody: JSON.stringify(job)
      }));
    } else {
      memoryQueue.push(job);
      setImmediate(() => {
        localListeners.forEach((fn) => fn());
      });
    }
    log.info('Job enqueued', { jobId: job.id, jobType: type, driver });
    return job;
  } catch (err) {
    log.error('Queue publish failed; falling back to in-memory queue', {
      jobType: type,
      driver,
      error: err.message
    });
    memoryQueue.push(job);
    return job;
  }
}

/**
 * Pull a single job from configured broker (used by worker container)
 */
async function dequeueJob(timeoutSeconds = 2) {
  const driver = config.queue.driver;

  if (driver === 'redis') {
    const res = await getRedis().blpop(config.queue.queueKey, timeoutSeconds);
    if (!res) return null;
    return JSON.parse(res[1]);
  }

  if (driver === 'sqs' && config.queue.sqsQueueUrl) {
    const { sqsClient: client, sqsCommands: cmds } = getSqs();
    const out = await client.send(new cmds.ReceiveMessageCommand({
      QueueUrl: config.queue.sqsQueueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: Math.min(timeoutSeconds, 10)
    }));
    if (!out.Messages || out.Messages.length === 0) return null;
    const msg = out.Messages[0];
    await client.send(new cmds.DeleteMessageCommand({
      QueueUrl: config.queue.sqsQueueUrl,
      ReceiptHandle: msg.ReceiptHandle
    }));
    return JSON.parse(msg.Body);
  }

  if (memoryQueue.length > 0) {
    return memoryQueue.shift();
  }
  return null;
}

async function getQueueHealth() {
  const driver = config.queue.driver;
  try {
    if (driver === 'redis') {
      const start = Date.now();
      const depth = await getRedis().llen(config.queue.queueKey);
      return { healthy: true, driver: 'redis', latencyMs: Date.now() - start, depth };
    }
    if (driver === 'sqs') {
      return { healthy: Boolean(config.queue.sqsQueueUrl), driver: 'sqs', depth: null };
    }
    return { healthy: true, driver: 'memory', latencyMs: 0, depth: memoryQueue.length };
  } catch (err) {
    return { healthy: false, driver, error: err.message };
  }
}

function onMemoryJob(fn) {
  localListeners.push(fn);
}

module.exports = { enqueueJob, dequeueJob, getQueueHealth, onMemoryJob };
