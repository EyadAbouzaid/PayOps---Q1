const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { PaymentClient } = require('./clients/PaymentClient');
const { createApp } = require('./app');
const { startReconciliationJob } = require('./jobs/reconciliationJob');

const paymentClient = new PaymentClient();
const app = createApp({ db, paymentClient });

startReconciliationJob({ db, paymentClient, intervalMs: config.RECONCILE_INTERVAL_MS });

app.listen(config.PORT, config.HOST, () => {
  logger.info(`Order Service listening on http://${config.HOST}:${config.PORT}`, {
    currency: config.CURRENCY,
    payops_url: config.PAYOPS_API_URL,
  });
});
