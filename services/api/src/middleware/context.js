const crypto = require('crypto');
const config = require('../../../../shared/config');
const { httpRequestDurationMs } = require('../../../../shared/metrics');

function attachRequestContext(req, res, next) {
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  const requestedMode = String(req.headers['x-payops-mode'] || req.query.mode || config.defaultMode).toLowerCase();
  req.envMode = requestedMode === 'live' ? 'live' : 'test';
  res.setHeader('X-Trace-Id', req.traceId);
  res.setHeader('X-PayOps-Mode', req.envMode);
  res.setHeader('X-PayOps-Commit', config.gitCommitSha);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const feature = req.baseUrl ? req.baseUrl.replace('/api/', '') || 'core' : 'core';
    const routeLabel = req.route && req.route.path ? `${req.baseUrl}${req.route.path}` : req.path;
    httpRequestDurationMs.observe(
      {
        method: req.method,
        route: routeLabel,
        status_code: String(res.statusCode),
        feature
      },
      duration
    );
  });

  next();
}

module.exports = { attachRequestContext };
