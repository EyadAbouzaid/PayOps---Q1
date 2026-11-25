const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentClient, PaymentClientError } = require('../src/clients/PaymentClient');

test('PaymentClient maps all PayOps statuses accurately', () => {
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('succeeded'), 'PAID');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('failed'), 'PAYMENT_FAILED');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('processing'), 'PENDING_PAYMENT');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('requires_confirmation'), 'PENDING_PAYMENT');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('requires_payment_method'), 'PENDING_PAYMENT');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('requires_capture'), 'PENDING_PAYMENT');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('canceled'), 'CANCELLED');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('partially_captured'), 'PENDING_PAYMENT');
  assert.equal(PaymentClient.mapIntentStatusToOrderStatus('unknown_future_status'), 'PENDING_PAYMENT');
});

test('PaymentClient parses string amount_cents from PayOps into integer', () => {
  assert.equal(PaymentClient.parseAmountCents('30000'), 30000);
  assert.strictEqual(typeof PaymentClient.parseAmountCents('12500'), 'number');
  assert.equal(PaymentClient.parseAmountCents(500), 500);
  assert.equal(PaymentClient.parseAmountCents('0'), 0);
  assert.equal(PaymentClient.parseAmountCents(null), 0);
  assert.equal(PaymentClient.parseAmountCents(undefined), 0);
  assert.equal(PaymentClient.parseAmountCents('abc'), 0);
});

test('PaymentClient createPayment sends auth headers, Idempotency-Key=order.id, metadata.order_id, and parses response', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/payments/tokenize')) {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ token: 'vault_tok_test_abc', last4: '4242', card_network: 'visa' }),
      };
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        intent: {
          id: 'pi_12345',
          status: 'succeeded',
          amount_cents: '30000',
          currency: 'USD',
          created_at: '2026-11-22T19:32:27.222Z',
        },
        extra_unknown_field: 'ignored',
      }),
    };
  };

  const client = new PaymentClient({
    baseUrl: 'http://payops-test:3005',
    apiKey: 'sk_test_demo_123',
    mode: 'test',
    fetchImpl: mockFetch,
  });

  const res = await client.createPayment({
    id: 'order_999',
    total_amount_cents: 30000,
    customer_email: 'user@example.com',
    card: { number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' },
  });

  assert.equal(calls.length, 2);
  const payCall = calls[1];
  const payHeaders = payCall.opts.headers;
  assert.equal(payHeaders['Authorization'], 'Bearer sk_test_demo_123');
  assert.equal(payHeaders['x-payops-mode'], 'test');
  assert.equal(payHeaders['Idempotency-Key'], 'order_999');

  const parsedBody = JSON.parse(payCall.opts.body);
  assert.equal(parsedBody.amount_cents, 30000);
  assert.equal(parsedBody.currency, 'USD');
  assert.equal(parsedBody.metadata.order_id, 'order_999');
  assert.equal(parsedBody.vault_token, 'vault_tok_test_abc');
  assert.equal(parsedBody.card, null);

  assert.equal(res.intentId, 'pi_12345');
  assert.equal(res.orderStatus, 'PAID');
  assert.strictEqual(res.amountCents, 30000);
});

test('PaymentClient handles 409 conflict by fetching payment status via GET when payment_intent_id is available', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === 'POST') {
      return {
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ error: { code: 'idempotency_conflict', message: 'In progress' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        intent: { id: 'pi_existing', status: 'succeeded', amount_cents: '15000', currency: 'USD' },
      }),
    };
  };

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch });
  const res = await client.createPayment({
    id: 'order_conflict',
    total_amount_cents: 15000,
    payment_intent_id: 'pi_existing',
    vault_token: 'vault_tok_test_1',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[1].method, 'GET');
  assert.match(calls[1].url, /\/api\/payments\/pi_existing$/);
  assert.equal(res.orderStatus, 'PAID');
});

test('PaymentClient throws on 409 when no payment_intent_id is available to fall back to', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 409,
    text: async () => JSON.stringify({ error: { code: 'payment_intent_locked', message: 'Locked' } }),
  });

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch });
  await assert.rejects(
    () => client.createPayment({
      id: 'order_no_intent',
      total_amount_cents: 10000,
      vault_token: 'vault_tok_test_1',
      // no payment_intent_id
    }),
    (err) => err instanceof PaymentClientError && err.isConflict === true && err.statusCode === 409
  );
});

test('PaymentClient throws retryable error on 5xx or timeout so order stays PENDING_PAYMENT', async () => {
  const mockFetch500 = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ error: { code: 'upstream_down', message: 'Unavailable' } }),
  });

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch500 });
  await assert.rejects(
    () => client.createPayment({ id: 'order_500', total_amount_cents: 1000, vault_token: 'vault_tok_1' }),
    (err) => err instanceof PaymentClientError && err.isRetryable === true && err.statusCode === 503
  );

  const mockFetchTimeout = async () => {
    throw new Error('The operation was aborted due to timeout');
  };
  const timeoutClient = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetchTimeout });
  await assert.rejects(
    () => timeoutClient.createPayment({ id: 'order_to', total_amount_cents: 1000, vault_token: 'vault_tok_1' }),
    (err) => err instanceof PaymentClientError && err.isRetryable === true
  );
});

test('PaymentClient tokenize sends card data and returns vault token', async () => {
  const mockFetch = async (url, opts) => {
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        object: 'vault_token',
        token: 'vault_tok_test_xyz',
        merchant_id: 'merch_test_default',
        env_mode: 'test',
        last4: '4242',
        card_network: 'visa',
        created_at: '2026-11-22T19:32:27.222Z',
      }),
    };
  };

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch });
  const result = await client.tokenize({ number: '4242424242424242', cvv: '424', exp_month: '12', exp_year: '2029' });
  assert.equal(result.vaultToken, 'vault_tok_test_xyz');
  assert.equal(result.last4, '4242');
  assert.equal(result.cardNetwork, 'visa');
});

test('PaymentClient getPayment retrieves intent and normalizes status', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      intent: { id: 'pi_lookup', status: 'processing', amount_cents: '20000', currency: 'USD' },
      attempts: [],
      refunds: [],
    }),
  });

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch });
  const result = await client.getPayment('pi_lookup');
  assert.equal(result.intentId, 'pi_lookup');
  assert.equal(result.orderStatus, 'PENDING_PAYMENT');
  assert.equal(result.amountCents, 20000);
});

test('PaymentClient refund sends correct payload and parses response', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        refund: {
          id: 'ref_1',
          intent_id: 'pi_refund',
          amount_cents: '5000',
          currency: 'USD',
          refund_status: 'succeeded',
        },
      }),
    };
  };

  const client = new PaymentClient({ baseUrl: 'http://payops-test:3005', fetchImpl: mockFetch });
  const result = await client.refund('pi_refund', 5000);
  assert.equal(result.refundId, 'ref_1');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.amountCents, 5000);

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.amount_cents, 5000);
  assert.equal(body.reason, 'requested_by_customer');
});
