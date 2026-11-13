-- Default Sandbox Mock Merchant Webhook Endpoint & Sample Schedules
INSERT INTO webhook_endpoints (id, env_mode, merchant_id, target_url, signing_secret, active)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'test',
    'merch_default',
    'http://localhost:3000/api/webhooks/mock-merchant',
    'whsec_test_sandbox_secret_key',
    TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO billing_schedules (id, env_mode, schedule_type, name, recipient_email, amount_cents, currency, interval_cron, next_run_at)
VALUES
(
    '22222222-2222-2222-2222-222222222222',
    'test',
    'payroll',
    'Monthly Cloud Engineering Payroll Batch',
    'payroll-ops@example.com',
    450000,
    'USD',
    '0 9 1 * *',
    NOW() - INTERVAL '5 minutes'
),
(
    '33333333-3333-3333-3333-333333333333',
    'test',
    'subscription',
    'Enterprise Merchant SaaS Retainer',
    'billing@merchant-store.example',
    29900,
    'USD',
    '0 0 * * *',
    NOW() - INTERVAL '1 minute'
) ON CONFLICT (id) DO NOTHING;
