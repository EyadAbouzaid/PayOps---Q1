const config = require('./config');

const MAX_RECENT_LOGS = 250;
const recentLogs = [];

function pushRecentLog(record) {
  recentLogs.unshift(record);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.length = MAX_RECENT_LOGS;
  }
}

/**
 * Structured JSON Logger for CloudWatch Logs (/ecs/payops-task) + UI Logs Explorer
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
    pushRecentLog(record);
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

function getRecentLogs({ feature = '', level = '', limit = 80 } = {}) {
  const capped = Math.min(Math.max(parseInt(limit, 10) || 80, 1), MAX_RECENT_LOGS);
  return recentLogs
    .filter((item) => {
      if (feature && feature !== 'all' && !String(item.feature).startsWith(feature)) return false;
      if (level && level !== 'all' && item.level !== level.toUpperCase()) return false;
      return true;
    })
    .slice(0, capped);
}

module.exports = { createLogger, getRecentLogs };
