const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const client = require('prom-client');

const PORT = parseInt(process.env.PORT || '3005', 10);
const HOST = process.env.HOST || '0.0.0.0';
const WEBHOOK_SECRET = process.env.PAYOPS_WEBHOOK_SECRET || 'whsec_test_demo_secret_1234567890';
const DEFAULT_WEBHOOK_URL = process.env.ORDER_WEBHOOK_CALLBACK_URL || 'http://order-service:4001/api/webhooks/payments';

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpCounter = new client.Counter({
  name: 'payops_mock_http_requests_total',
  help: 'Total HTTP requests to PayOps Mock',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

function log(level, message, extra = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'payops-mock',
    level,
    message,
    ...extra,
  }));
}

// In-memory state matching PayOps contract
const state = {
  tokens: new Map(),
  intents: new Map(),
  attempts: new Map(),
  refunds: new Map(),
  idempotencyCache: new Map(),
  inFlightIdempotency: new Set(),
  webhookEndpoints: [],
  deliveries: [],
  // Simulation controls for testing
  simulation: {
    forceHttpStatus: null, // e.g., 500, 503, 409
    latencyMs: 0,
    webhookMode: 'immediate', // 'immediate' | 'delayed' | 'duplicate' | 'drop'
    webhookDelayMs: 1500,
    asyncProcessing: false, // if true, initial POST returns 'processing' and webhook finishes it
  },
};

if (DEFAULT_WEBHOOK_URL) {
  state.webhookEndpoints.push({
    id: uuidv4(),
    merchant_id: 'merch_test_default',
    env_mode: 'test',
    target_url: DEFAULT_WEBHOOK_URL,
    signing_secret: WEBHOOK_SECRET,
    events: ['payment.succeeded', 'payment.failed', 'refund.succeeded'],
    active: true,
    created_at: new Date().toISOString(),
  });
}

function signWebhookPayload(secret, timestampSec, rawBody) {
  const signingInput = `${timestampSec}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signingInput).digest('hex');
  return `t=${timestampSec},v1=${v1}`;
}

async function deliverSingleWebhook(endpoint, eventType, data, customDeliveryId = null, customTimestamp = null) {
  const deliveryId = customDeliveryId || uuidv4();
  const createdAt = new Date().toISOString();
  const timestampSec = customTimestamp || Math.floor(Date.now() / 1000).toString();

  const envelope = {
    id: deliveryId,
    event_type: eventType,
    created_at: createdAt,
    data,
  };
  const rawBody = JSON.stringify(envelope);
  const signature = signWebhookPayload(endpoint.signing_secret, timestampSec, rawBody);

  const record = {
    id: deliveryId,
    endpoint_id: endpoint.id,
    event_type: eventType,
    status: 'pending',
    payload: envelope,
    created_at: createdAt,
  };
  state.deliveries.unshift(record);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpoint.target_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PayOps-Webhook-Dispatcher/1.0',
        'X-PayOps-Event': eventType,
        'X-PayOps-Delivery-Id': deliveryId,
        'X-PayOps-Timestamp': timestampSec,
        'X-PayOps-Signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    record.status = res.ok ? 'success' : 'failed';
    record.response_status = res.status;
    log('info', 'Webhook delivered', { delivery_id: deliveryId, event_type: eventType, status: record.status, http_status: res.status });
  } catch (err) {
    record.status = 'failed';
    record.error = err.message;
    log('warn', 'Webhook delivery failed', { delivery_id: deliveryId, event_type: eventType, error: err.message });
  }
  return record;
}

async function emitWebhookEvent(eventType, data) {
  const mode = state.simulation.webhookMode;
  if (mode === 'drop') {
    log('info', 'Webhook dropped due to simulation mode=drop', { event_type: eventType, data });
    return;
  }
  const activeEndpoints = state.webhookEndpoints.filter((ep) => ep.active && ep.events.includes(eventType));
  for (const ep of activeEndpoints) {
    const dispatch = async () => {
      const rec = await deliverSingleWebhook(ep, eventType, data);
      if (mode === 'duplicate') {
        await deliverSingleWebhook(ep, eventType, data, rec.id);
      }
    };
    if (mode === 'delayed') {
      setTimeout(dispatch, state.simulation.webhookDelayMs);
    } else {
      setImmediate(dispatch);
    }
  }
}

function createApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    res.on('finish', () => {
      httpCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
    });
    next();
  });

  // Liveness, Readiness, Status, Metrics
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'payops-mock' }));
  app.get('/ready', (_req, res) => res.status(200).json({ status: 'ready', service: 'payops-mock' }));
  app.get('/status', (_req, res) => res.status(200).json({ service: 'payops-mock', mode: 'test', simulation: state.simulation }));
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Simulation control endpoints for integration tests
  app.post('/_mock/config', (req, res) => {
    Object.assign(state.simulation, req.body || {});
    log('info', 'Updated simulation config', { simulation: state.simulation });
    res.json({ simulation: state.simulation });
  });

  app.post('/_mock/reset', (_req, res) => {
    state.tokens.clear();
    state.intents.clear();
    state.attempts.clear();
    state.refunds.clear();
    state.idempotencyCache.clear();
    state.inFlightIdempotency.clear();
    state.deliveries = [];
    state.simulation = {
      forceHttpStatus: null,
      latencyMs: 0,
      webhookMode: 'immediate',
      webhookDelayMs: 1500,
      asyncProcessing: false,
    };
    res.json({ reset: true });
  });

  app.post('/_mock/trigger-webhook', async (req, res) => {
    const { event_type, data, delivery_id, timestamp_sec, secret_override } = req.body;
    const ep = state.webhookEndpoints[0];
    if (!ep) return res.status(404).json({ error: { code: 'no_endpoint', message: 'No webhook endpoint registered' } });
    const targetEp = secret_override ? { ...ep, signing_secret: secret_override } : ep;
    const rec = await deliverSingleWebhook(targetEp, event_type || 'payment.succeeded', data || {}, delivery_id, timestamp_sec);
    res.status(202).json({ delivery: rec });
  });

  // Auth middleware per PayOps contract
  function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    let key = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      key = authHeader.slice(7).trim();
    } else if (apiKeyHeader) {
      key = String(apiKeyHeader).trim();
    }

    if (!key) {
      return res.status(401).json({
        error: { code: 'missing_api_key', message: 'Provide a valid PayOps API key in Authorization or x-api-key.' },
      });
    }
    if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_')) {
      return res.status(401).json({
        error: { code: 'invalid_api_key_format', message: 'API key must start with sk_test_ or sk_live_.' },
      });
    }

    const keyMode = key.startsWith('sk_test_') ? 'test' : 'live';
    const headerMode = req.headers['x-payops-mode'];
    if (headerMode && headerMode !== keyMode) {
      return res.status(403).json({
        error: { code: 'environment_mode_mismatch', message: 'API key mode differs from x-payops-mode.' },
      });
    }

    req.payopsAuth = {
      key,
      env_mode: keyMode,
      merchant_id: keyMode === 'test' ? 'merch_test_default' : 'merch_live_default',
    };
    next();
  }

  // Simulation fault/latency middleware for /api/*
  app.use('/api', async (req, res, next) => {
    if (state.simulation.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, state.simulation.latencyMs));
    }
    if (state.simulation.forceHttpStatus) {
      const code = state.simulation.forceHttpStatus;
      if (code === 409) {
        return res.status(409).json({
          error: { code: 'idempotency_conflict', message: 'Another request with the same Idempotency-Key is currently in progress.' },
        });
      }
      return res.status(code).json({
        error: { code: 'simulated_upstream_error', message: `Simulated PayOps HTTP ${code} failure` },
      });
    }
    next();
  });

  // POST /api/payments/tokenize
  app.post('/api/payments/tokenize', authMiddleware, (req, res) => {
    const { card } = req.body || {};
    if (!card || !card.number || !card.cvv || !card.exp_month || !card.exp_year) {
      return res.status(400).json({
        error: { code: 'invalid_card', message: 'card object with number, cvv, exp_month, exp_year is required.' },
      });
    }
    const last4 = String(card.number).slice(-4);
    const token = `vault_tok_${req.payopsAuth.env_mode}_${uuidv4().replace(/-/g, '')}`;
    const network = String(card.number).startsWith('4') ? 'visa' : 'mastercard';
    const record = {
      object: 'vault_token',
      token,
      merchant_id: req.payopsAuth.merchant_id,
      env_mode: req.payopsAuth.env_mode,
      last4,
      card_network: network,
      // Store card number inside mock vault only to drive deterministic test card outcomes
      _mock_card_number: String(card.number),
      created_at: new Date().toISOString(),
    };
    state.tokens.set(token, record);
    const { _mock_card_number, ...publicResponse } = record;
    return res.status(201).json(publicResponse);
  });

  // POST /api/payments
  app.post('/api/payments', authMiddleware, async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'];
    const cacheScope = idempotencyKey
      ? `${req.payopsAuth.env_mode}:${req.payopsAuth.merchant_id}:POST:/api/payments:${idempotencyKey}`
      : null;

    if (cacheScope) {
      if (state.inFlightIdempotency.has(cacheScope)) {
        return res.status(409).json({
          error: { code: 'idempotency_conflict', message: 'Another request with the same Idempotency-Key is currently in progress.' },
        });
      }
      if (state.idempotencyCache.has(cacheScope)) {
        const cached = state.idempotencyCache.get(cacheScope);
        res.set('X-PayOps-Idempotent-Replay', 'true');
        return res.status(cached.status).json(cached.body);
      }
      state.inFlightIdempotency.add(cacheScope);
    }

    try {
      const {
        amount_cents,
        currency = 'USD',
        capture_method = 'automatic',
        confirm = true,
        customer_email = null,
        description = null,
        metadata = {},
        card = null,
        vault_token = null,
      } = req.body || {};

      if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
        return res.status(400).json({
          error: { code: 'invalid_amount', message: 'amount_cents must be a strict positive integer.' },
        });
      }

      if (confirm && !card && !vault_token) {
        return res.status(400).json({
          error: { code: 'missing_payment_method', message: 'Execution requested without card or vault_token.' },
        });
      }

      let resolvedToken = vault_token;
      let cardNumber = '';
      if (card && card.number) {
        cardNumber = String(card.number);
        resolvedToken = `vault_tok_${req.payopsAuth.env_mode}_${uuidv4().replace(/-/g, '')}`;
      } else if (vault_token && state.tokens.has(vault_token)) {
        cardNumber = state.tokens.get(vault_token)._mock_card_number || '';
      }

      const intentId = uuidv4();
      const now = new Date().toISOString();
      const amountStr = String(amount_cents); // Contract rule 3: PayOps returns amount_cents as STRING

      let intentStatus = 'requires_payment_method';
      let activeAttempt = null;
      const attempts = [];

      if (!confirm) {
        intentStatus = vault_token || card ? 'requires_confirmation' : 'requires_payment_method';
      } else {
        // Card ending in 0002 or 9999 simulates decline; 4242424242424242 succeeds
        const isDeclined = cardNumber.endsWith('0002') || cardNumber.endsWith('9999') || metadata.simulate_failure === true;
        const isAsync = state.simulation.asyncProcessing || metadata.simulate_processing === true;

        const attemptId = uuidv4();
        let attemptStatus = 'charged';
        if (isAsync) {
          intentStatus = 'processing';
          attemptStatus = 'pending';
        } else if (isDeclined) {
          intentStatus = 'failed';
          attemptStatus = 'failure';
        } else if (capture_method === 'manual') {
          intentStatus = 'requires_capture';
          attemptStatus = 'authorized';
        } else {
          intentStatus = 'succeeded';
          attemptStatus = 'charged';
        }

        activeAttempt = {
          id: attemptId,
          intent_id: intentId,
          env_mode: req.payopsAuth.env_mode,
          merchant_id: req.payopsAuth.merchant_id,
          connector: 'mock_stripe',
          attempt_index: 1,
          status: attemptStatus,
          amount_cents: amountStr,
          currency: String(currency).toUpperCase(),
          connector_transaction_id: `mock_stripe_ch_${uuidv4().slice(0, 12)}`,
          error_code: isDeclined ? 'card_declined' : null,
          error_message: isDeclined ? 'Your card was declined.' : null,
          vault_token: resolvedToken,
          metadata,
          created_at: now,
          updated_at: now,
        };
        attempts.push(activeAttempt);
        state.attempts.set(intentId, attempts);

        if (isAsync) {
          const finalStatus = isDeclined ? 'failed' : 'succeeded';
          setTimeout(() => {
            const stored = state.intents.get(intentId);
            if (stored) {
              stored.status = finalStatus;
              stored.updated_at = new Date().toISOString();
              if (activeAttempt) {
                activeAttempt.status = finalStatus === 'succeeded' ? 'charged' : 'failure';
              }
              emitWebhookEvent(finalStatus === 'succeeded' ? 'payment.succeeded' : 'payment.failed', {
                intent_id: intentId,
                amount_cents: amountStr,
                currency: stored.currency,
                status: finalStatus,
                connector: 'mock_stripe',
                attempt_count: 1,
                failover_triggered: false,
              });
            }
          }, 800);
        } else if (intentStatus === 'succeeded' || intentStatus === 'failed') {
          emitWebhookEvent(intentStatus === 'succeeded' ? 'payment.succeeded' : 'payment.failed', {
            intent_id: intentId,
            amount_cents: amountStr,
            currency: String(currency).toUpperCase(),
            status: intentStatus,
            connector: 'mock_stripe',
            attempt_count: 1,
            failover_triggered: false,
          });
        }
      }

      const intent = {
        id: intentId,
        merchant_id: req.payopsAuth.merchant_id,
        env_mode: req.payopsAuth.env_mode,
        amount_cents: amountStr,
        currency: String(currency).toUpperCase(),
        capture_method,
        status: intentStatus,
        active_attempt_id: activeAttempt ? activeAttempt.id : null,
        attempt_count: attempts.length,
        customer_email,
        description,
        metadata,
        created_at: now,
        updated_at: now,
      };
      state.intents.set(intentId, intent);

      const responseBody = {
        intent,
        active_attempt: activeAttempt,
        attempts,
        routing_summary: {
          algorithm: 'Priority: Stripe -> Paymob',
          type: 'priority',
          evaluated_connectors: ['mock_stripe', 'mock_paymob'],
          skipped_open_circuits: [],
          failover_triggered: false,
        },
        invoice: null,
      };

      if (cacheScope) {
        state.idempotencyCache.set(cacheScope, { status: 201, body: responseBody });
      }
      return res.status(201).json(responseBody);
    } finally {
      if (cacheScope) state.inFlightIdempotency.delete(cacheScope);
    }
  });

  // GET /api/payments
  app.get('/api/payments', authMiddleware, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const items = Array.from(state.intents.values())
      .filter((i) => i.env_mode === req.payopsAuth.env_mode)
      .slice(0, limit);
    res.json({ mode: req.payopsAuth.env_mode, count: items.length, items });
  });

  // GET /api/payments/:id
  app.get('/api/payments/:id', authMiddleware, (req, res) => {
    const intent = state.intents.get(req.params.id);
    if (!intent || intent.env_mode !== req.payopsAuth.env_mode) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }
    res.json({
      intent,
      attempts: state.attempts.get(intent.id) || [],
      refunds: state.refunds.get(intent.id) || [],
    });
  });

  // POST /api/payments/:id/confirm
  app.post('/api/payments/:id/confirm', authMiddleware, (req, res) => {
    const intent = state.intents.get(req.params.id);
    if (!intent || intent.env_mode !== req.payopsAuth.env_mode) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }
    const { card, vault_token } = req.body || {};
    if (!card && !vault_token) {
      return res.status(400).json({ error: { code: 'missing_payment_method', message: 'Provide card or vault_token.' } });
    }
    intent.status = 'succeeded';
    intent.attempt_count += 1;
    intent.updated_at = new Date().toISOString();
    const attempt = {
      id: uuidv4(),
      intent_id: intent.id,
      env_mode: intent.env_mode,
      merchant_id: intent.merchant_id,
      connector: 'mock_stripe',
      attempt_index: intent.attempt_count,
      status: 'charged',
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      connector_transaction_id: `mock_stripe_ch_${uuidv4().slice(0, 12)}`,
      error_code: null,
      error_message: null,
      vault_token: vault_token || null,
      metadata: intent.metadata,
      created_at: intent.updated_at,
      updated_at: intent.updated_at,
    };
    const attempts = state.attempts.get(intent.id) || [];
    attempts.push(attempt);
    state.attempts.set(intent.id, attempts);
    emitWebhookEvent('payment.succeeded', {
      intent_id: intent.id,
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      status: 'succeeded',
      connector: 'mock_stripe',
      attempt_count: intent.attempt_count,
      failover_triggered: false,
    });
    return res.status(200).json({
      intent,
      active_attempt: attempt,
      attempts,
      routing_summary: { algorithm: 'Priority: Stripe -> Paymob', type: 'priority', evaluated_connectors: ['mock_stripe'], skipped_open_circuits: [], failover_triggered: false },
    });
  });

  // POST /api/payments/:id/capture
  app.post('/api/payments/:id/capture', authMiddleware, (req, res) => {
    const intent = state.intents.get(req.params.id);
    if (!intent || intent.env_mode !== req.payopsAuth.env_mode) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }
    if (intent.status !== 'requires_capture') {
      return res.status(409).json({ error: { code: 'invalid_capture_state', message: 'Intent is not requires_capture.' } });
    }
    intent.status = 'succeeded';
    intent.updated_at = new Date().toISOString();
    const attempts = state.attempts.get(intent.id) || [];
    return res.status(200).json({ intent, active_attempt: attempts[attempts.length - 1] || null });
  });

  // POST /api/payments/:id/refund
  app.post('/api/payments/:id/refund', authMiddleware, (req, res) => {
    const intent = state.intents.get(req.params.id);
    if (!intent || intent.env_mode !== req.payopsAuth.env_mode) {
      return res.status(404).json({ error: { code: 'not_found', message: 'PaymentIntent not found.' } });
    }
    if (intent.status !== 'succeeded') {
      return res.status(409).json({ error: { code: 'invalid_refund_state', message: 'Intent is not succeeded.' } });
    }
    const { amount_cents, reason = 'requested_by_customer' } = req.body || {};
    const refundAmountStr = amount_cents ? String(amount_cents) : intent.amount_cents;
    const attempts = state.attempts.get(intent.id) || [];
    const lastAttempt = attempts[attempts.length - 1] || {};
    const refund = {
      id: uuidv4(),
      intent_id: intent.id,
      attempt_id: lastAttempt.id || uuidv4(),
      env_mode: intent.env_mode,
      merchant_id: intent.merchant_id,
      connector: 'mock_stripe',
      connector_transaction_id: lastAttempt.connector_transaction_id || 'mock_stripe_ch_demo',
      connector_refund_id: `mock_stripe_re_${uuidv4().slice(0, 12)}`,
      amount_cents: refundAmountStr,
      currency: intent.currency,
      refund_status: 'succeeded',
      reason,
      created_at: new Date().toISOString(),
    };
    const existingRefunds = state.refunds.get(intent.id) || [];
    existingRefunds.push(refund);
    state.refunds.set(intent.id, existingRefunds);
    emitWebhookEvent('refund.succeeded', {
      refund_id: refund.id,
      intent_id: intent.id,
      amount_cents: refundAmountStr,
      currency: intent.currency,
      connector: 'mock_stripe',
    });
    return res.status(201).json({ refund });
  });

  // Webhook management endpoints per contract
  app.post('/api/webhooks/endpoints', authMiddleware, (req, res) => {
    const { target_url, events = ['payment.succeeded', 'payment.failed', 'refund.succeeded'] } = req.body || {};
    if (!target_url || (!target_url.startsWith('http://') && !target_url.startsWith('https://'))) {
      return res.status(400).json({ error: { code: 'invalid_target_url', message: 'target_url must start with http:// or https://' } });
    }
    const ep = {
      id: uuidv4(),
      merchant_id: req.payopsAuth.merchant_id,
      env_mode: req.payopsAuth.env_mode,
      target_url,
      signing_secret: WEBHOOK_SECRET,
      events,
      active: true,
      created_at: new Date().toISOString(),
    };
    state.webhookEndpoints.push(ep);
    return res.status(201).json({ endpoint: ep });
  });

  app.get('/api/webhooks/deliveries', authMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit || '30', 10);
    const items = state.deliveries.slice(0, limit);
    res.json({ count: items.length, items });
  });

  app.post('/api/webhooks/deliveries/:id/replay', authMiddleware, async (req, res) => {
    const delivery = state.deliveries.find((d) => d.id === req.params.id);
    if (!delivery) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Delivery not found.' } });
    }
    delivery.status = 'replaying';
    const ep = state.webhookEndpoints.find((e) => e.id === delivery.endpoint_id) || state.webhookEndpoints[0];
    if (ep) {
      setImmediate(() => deliverSingleWebhook(ep, delivery.event_type, delivery.payload.data, delivery.id));
    }
    res.json({ message: 'Webhook replay queued.', delivery });
  });

  app.post('/api/webhooks/test', authMiddleware, (req, res) => {
    const { event_type = 'payment.succeeded', payload = { test: true, timestamp: new Date().toISOString() } } = req.body || {};
    emitWebhookEvent(event_type, payload);
    res.status(202).json({ queued: true, job_id: uuidv4() });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'route_not_found', message: `Route ${req.method} ${req.path} does not exist.` },
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    log('info', `PayOps Mock listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { createApp, state, signWebhookPayload };
