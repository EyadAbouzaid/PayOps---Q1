const CURRENCY = process.env.CURRENCY || 'USD';

module.exports = {
  PORT: parseInt(process.env.PORT || '4001', 10),
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://ecommerce:ecommerce_secret@localhost:5433/ecommerce',
  JWT_SECRET: process.env.JWT_SECRET || 'super_secret_ecommerce_jwt_key_change_me',
  CURRENCY,
  PAYOPS_API_URL: (process.env.PAYOPS_API_URL || 'http://localhost:3005').replace(/\/$/, ''),
  PAYOPS_API_KEY: process.env.PAYOPS_API_KEY || 'sk_test_demo_000000000000000000000000',
  PAYOPS_MODE: process.env.PAYOPS_MODE || 'test',
  PAYOPS_WEBHOOK_SECRET: process.env.PAYOPS_WEBHOOK_SECRET || 'whsec_test_demo_secret_1234567890',
  RECONCILE_INTERVAL_MS: parseInt(process.env.RECONCILE_INTERVAL_MS || '120000', 10),
  PENDING_ORDER_TIMEOUT_MINUTES: parseInt(process.env.PENDING_ORDER_TIMEOUT_MINUTES || '30', 10),
  PRODUCT_SERVICE_URL: (process.env.PRODUCT_SERVICE_URL || 'http://product-service:4002').replace(/\/$/, ''),
  CART_SERVICE_URL: (process.env.CART_SERVICE_URL || 'http://cart-service:4003').replace(/\/$/, ''),
};
