const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'payops_' });

const httpRequestDurationMs = new client.Histogram({
  name: 'payops_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds across microservices/features',
  labelNames: ['method', 'route', 'status_code', 'feature'],
  buckets: [5, 15, 30, 60, 120, 250, 500, 1000, 2500]
});

const transactionsCounter = new client.Counter({
  name: 'payops_transactions_total',
  help: 'Total payment requests processed by status and mode',
  labelNames: ['status', 'env_mode', 'currency']
});

const invoicesCounter = new client.Counter({
  name: 'payops_invoices_generated_total',
  help: 'Total official PDF invoices generated',
  labelNames: ['status', 'storage_driver']
});

const webhooksCounter = new client.Counter({
  name: 'payops_webhook_deliveries_total',
  help: 'Total signed webhook delivery attempts',
  labelNames: ['status', 'event_type']
});

const billingRunsCounter = new client.Counter({
  name: 'payops_billing_runs_total',
  help: 'Total scheduled payroll and subscription executions',
  labelNames: ['schedule_type', 'status']
});

register.registerMetric(httpRequestDurationMs);
register.registerMetric(transactionsCounter);
register.registerMetric(invoicesCounter);
register.registerMetric(webhooksCounter);
register.registerMetric(billingRunsCounter);

module.exports = {
  register,
  httpRequestDurationMs,
  transactionsCounter,
  invoicesCounter,
  webhooksCounter,
  billingRunsCounter
};
