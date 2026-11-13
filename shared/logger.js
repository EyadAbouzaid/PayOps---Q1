const config = require('./config');

/**
 * Structured JSON Logger for CloudWatch Logs Live Tail (/ecs/payops-task)
 * Filter in CloudWatch by: { $.feature = "payments" && $.level = "ERROR" }
 */
function createLogger(feature) {
  function emit(level, message, meta = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: config.serviceName,
      feature,
      hostname: config.hostname,
      commitSha: config.gitCommitSha,
      buildNumber: config.jenkinsBuildNumber,
      message,
      ...meta
    };
    const line = JSON.stringify(record);
    if (level === 'ERROR') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    info: (msg, meta) => emit('INFO', msg, meta),
    warn: (msg, meta) => emit('WARN', msg, meta),
    error: (msg, meta) => emit('ERROR', msg, meta),
    debug: (msg, meta) => {
      if (process.env.LOG_LEVEL === 'debug') emit('DEBUG', msg, meta);
    }
  };
}

module.exports = { createLogger };
