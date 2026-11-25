const config = require('../config');
const logger = require('../logger');

class PaymentClientError extends Error {
  constructor(message, { statusCode = 500, code = 'payops_error', isRetryable = false, isConflict = false } = {}) {
    super(message);
    this.name = 'PaymentClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.isRetryable = isRetryable;
    this.isConflict = isConflict;
  }
}

class PaymentClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || config.PAYOPS_API_URL).replace(/\/$/, '');
    this.apiKey = options.apiKey || config.PAYOPS_API_KEY;
    this.mode = options.mode || config.PAYOPS_MODE;
    this.currency = options.currency || config.CURRENCY;
    this.timeoutMs = options.timeoutMs || 8000;
    this.fetchImpl = options.fetchImpl || global.fetch;
  }

  /**
   * Rule 4: Status mapping lives in PaymentClient ONLY.
   */
  static mapIntentStatusToOrderStatus(payopsStatus) {
    switch (payopsStatus) {
      case 'succeeded':
        return 'PAID';
      case 'failed':
        return 'PAYMENT_FAILED';
      case 'processing':
      case 'requires_confirmation':
      case 'requires_payment_method':
      case 'requires_capture':
        return 'PENDING_PAYMENT';
      case 'canceled':
        return 'CANCELLED';
      case 'partially_captured':
        return 'PENDING_PAYMENT';
      default:
        return 'PENDING_PAYMENT';
    }
  }

  /**
   * Rule 3: PayOps returns amount_cents as a STRING (e.g. "30000"). Parse to integer.
   */
  static parseAmountCents(rawAmount) {
    if (typeof rawAmount === 'number') return Math.trunc(rawAmount);
    const parsed = parseInt(String(rawAmount ?? '0'), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  _headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'x-payops-mode': this.mode,
      ...extra,
    };
  }

  async _request(method, path, { body = null, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this._headers(headers),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        const errCode = data?.error?.code || `http_${response.status}`;
        const errMsg = data?.error?.message || `PayOps responded with HTTP ${response.status}`;

        // Rule 7: 409 (idempotency_conflict / payment_intent_locked) -> do NOT resend; caller should GET payment status
        if (response.status === 409) {
          throw new PaymentClientError(errMsg, {
            statusCode: 409,
            code: errCode,
            isConflict: true,
            isRetryable: false,
          });
        }

        // Rule 7: 5xx -> retryable with SAME Idempotency-Key; keep order PENDING_PAYMENT
        if (response.status >= 500) {
          throw new PaymentClientError(errMsg, {
            statusCode: response.status,
            code: errCode,
            isRetryable: true,
          });
        }

        throw new PaymentClientError(errMsg, {
          statusCode: response.status,
          code: errCode,
          isRetryable: false,
        });
      }

      return data;
    } catch (err) {
      if (err instanceof PaymentClientError) throw err;
      // Network error or AbortError timeout -> Rule 7: keep PENDING_PAYMENT & retry with SAME Idempotency-Key
      throw new PaymentClientError(err.message || 'PayOps network/timeout error', {
        statusCode: 504,
        code: 'network_or_timeout',
        isRetryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  _normalizeIntentResponse(payload) {
    const intent = payload?.intent || payload || {};
    const rawStatus = intent.status || 'processing';
    return {
      intentId: intent.id || null,
      rawStatus,
      orderStatus: PaymentClient.mapIntentStatusToOrderStatus(rawStatus),
      amountCents: PaymentClient.parseAmountCents(intent.amount_cents),
      currency: intent.currency || this.currency,
      failureReason: payload?.active_attempt?.error_message || null,
    };
  }

  /**
   * Tokenize raw card via PayOps so raw card details are never stored.
   * Contract: POST /api/payments/tokenize
   */
  async tokenize(card) {
    const data = await this._request('POST', '/api/payments/tokenize', {
      body: {
        card: {
          number: String(card.number),
          cvv: String(card.cvv),
          exp_month: String(card.exp_month),
          exp_year: String(card.exp_year),
        },
      },
    });
    return {
      vaultToken: data.token,
      last4: data.last4,
      cardNetwork: data.card_network,
    };
  }

  /**
   * Create & confirm payment in PayOps.
   * Contract: POST /api/payments
   * Rules:
   * - Idempotency-Key header = order.id
   * - metadata.order_id = order.id
   * - currency = "USD"
   * - Uses vault_token (tokenized beforehand)
   */
  async createPayment(order) {
    const orderId = String(order.id);
    const amountCents = Number(order.total_amount_cents ?? order.amount_cents);

    let vaultToken = order.vault_token || null;
    if (!vaultToken && order.card) {
      const tok = await this.tokenize(order.card);
      vaultToken = tok.vaultToken;
    }

    const requestBody = {
      amount_cents: amountCents,
      currency: this.currency,
      capture_method: 'automatic',
      confirm: true,
      customer_email: order.customer_email || null,
      description: `Order ${orderId}`,
      metadata: {
        order_id: orderId,
        ...(order.metadata || {}),
      },
      card: null,
      vault_token: vaultToken,
      auto_invoice: true,
    };

    try {
      const data = await this._request('POST', '/api/payments', {
        body: requestBody,
        headers: {
          'Idempotency-Key': orderId,
        },
      });
      return this._normalizeIntentResponse(data);
    } catch (err) {
      // Rule 7: On 409 (idempotency_conflict / payment_intent_locked), do NOT resend; GET payment status if intentId is known
      if (err.isConflict) {
        if (order.payment_intent_id) {
          logger.warn('409 conflict on createPayment; fetching existing intent status', {
            order_id: orderId,
            payment_intent_id: order.payment_intent_id,
          });
          return this.getPayment(order.payment_intent_id);
        }
        // No payment_intent_id saved yet — cannot GET; re-throw so caller keeps order PENDING_PAYMENT
        logger.warn('409 conflict on createPayment but no payment_intent_id available; cannot recover', {
          order_id: orderId,
          code: err.code,
        });
        throw err;
      }
      throw err;
    }
  }

  /**
   * Retrieve PaymentIntent status.
   * Contract: GET /api/payments/:id
   */
  async getPayment(intentId) {
    const data = await this._request('GET', `/api/payments/${encodeURIComponent(intentId)}`);
    return this._normalizeIntentResponse(data);
  }

  /**
   * Refund a succeeded payment.
   * Contract: POST /api/payments/:id/refund
   */
  async refund(intentId, amount = undefined) {
    const body = { reason: 'requested_by_customer' };
    if (amount !== undefined && amount !== null) {
      body.amount_cents = Math.trunc(Number(amount));
    }
    const data = await this._request('POST', `/api/payments/${encodeURIComponent(intentId)}/refund`, {
      body,
      headers: {
        'Idempotency-Key': `refund_${intentId}_${body.amount_cents || 'full'}`,
      },
    });
    const refundObj = data?.refund || {};
    return {
      refundId: refundObj.id || null,
      intentId: refundObj.intent_id || intentId,
      status: refundObj.refund_status || 'failed',
      amountCents: PaymentClient.parseAmountCents(refundObj.amount_cents),
      currency: refundObj.currency || this.currency,
    };
  }
}

module.exports = { PaymentClient, PaymentClientError };
