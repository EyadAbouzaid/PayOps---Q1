function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'order-service',
    level,
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
