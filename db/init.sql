-- PayOps Q1 Core Database Schema (PostgreSQL 15+ / AWS RDS Compatible)
-- Supports isolated Test Mode ('test') vs Live Mode ('live') records

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Payments Table (Core Checkout & Orchestration)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) UNIQUE,
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test' CHECK (env_mode IN ('test', 'live')),
    merchant_id VARCHAR(64) NOT NULL DEFAULT 'merch_default',
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL DEFAULT 'Valued Customer',
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    status VARCHAR(32) NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_by_host VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_env_created ON payments(env_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 2. Official PDF Invoices Table (S3 + Pre-Signed URL ready)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(64) UNIQUE NOT NULL,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test',
    storage_driver VARCHAR(16) NOT NULL DEFAULT 'local' CHECK (storage_driver IN ('s3', 'local')),
    s3_bucket VARCHAR(128),
    object_key VARCHAR(512) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
    file_size_bytes INTEGER,
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices(payment_id);

-- 3. Automated Billing & Payroll Schedules
CREATE TABLE IF NOT EXISTS billing_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test',
    schedule_type VARCHAR(32) NOT NULL CHECK (schedule_type IN ('subscription', 'payroll')),
    name VARCHAR(255) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    interval_cron VARCHAR(64) NOT NULL DEFAULT '0 0 1 * *',
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_run_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_due ON billing_schedules(active, next_run_at);

-- 4. Billing & Payroll Execution Audit Runs
CREATE TABLE IF NOT EXISTS billing_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES billing_schedules(id) ON DELETE CASCADE,
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test',
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'completed', 'failed')),
    triggered_by VARCHAR(64) NOT NULL DEFAULT 'eventbridge-cron',
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Merchant Webhook Subscriptions
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test',
    merchant_id VARCHAR(64) NOT NULL DEFAULT 'merch_default',
    target_url TEXT NOT NULL,
    signing_secret VARCHAR(255) NOT NULL,
    events TEXT[] NOT NULL DEFAULT ARRAY['payment.succeeded', 'invoice.ready', 'billing.executed'],
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Webhook Delivery Audit Logs & Replay History
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID REFERENCES webhook_endpoints(id) ON DELETE SET NULL,
    env_mode VARCHAR(16) NOT NULL DEFAULT 'test',
    event_type VARCHAR(64) NOT NULL,
    target_url TEXT NOT NULL,
    payload JSONB NOT NULL,
    signature_header VARCHAR(255) NOT NULL,
    http_status INTEGER,
    response_body TEXT,
    duration_ms INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_env_created ON webhook_deliveries(env_mode, created_at DESC);
