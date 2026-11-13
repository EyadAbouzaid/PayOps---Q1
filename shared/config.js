const os = require('os');
const path = require('path');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  serviceName: process.env.SERVICE_NAME || 'payops-api',
  defaultMode: process.env.APP_DEFAULT_MODE === 'live' ? 'live' : 'test',
  gitCommitSha: process.env.GIT_COMMIT_SHA || 'local-dev',
  jenkinsBuildNumber: process.env.JENKINS_BUILD_NUMBER || '0',
  awsRegion: process.env.AWS_REGION || 'eu-north-1',
  hostname: os.hostname(),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'payops',
    user: process.env.DB_USER || 'payops_admin',
    password: process.env.DB_PASSWORD || 'change_me_in_secrets_manager',
    ssl: String(process.env.DB_SSL).toLowerCase() === 'true',
    autoMigrate: String(process.env.AUTO_MIGRATE || 'true').toLowerCase() === 'true'
  },

  queue: {
    driver: (process.env.QUEUE_DRIVER || 'memory').toLowerCase(), // redis | sqs | memory
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    sqsQueueUrl: process.env.SQS_QUEUE_URL || '',
    queueKey: 'payops:jobs:q1'
  },

  storage: {
    s3Bucket: process.env.S3_BUCKET_NAME || '',
    presignedTtlSeconds: parseInt(process.env.S3_PRESIGNED_TTL_SECONDS || '900', 10),
    localDir: process.env.LOCAL_INVOICE_DIR || path.join(process.cwd(), 'storage', 'invoices'),
    localSigningSecret: process.env.LOCAL_INVOICE_SECRET || 'payops-local-invoice-signing-key'
  },

  webhooks: {
    defaultSecret: process.env.WEBHOOK_SIGNING_SECRET || 'whsec_payops_hmac_sha256_secret',
    timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10)
  },

  cronTriggerToken: process.env.CRON_TRIGGER_TOKEN || 'cron_payops_eventbridge_token',
  serveStaticFrontend: String(process.env.SERVE_STATIC_FRONTEND || 'true').toLowerCase() === 'true'
};
