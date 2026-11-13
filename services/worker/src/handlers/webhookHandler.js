const db = require('../../../../shared/db');
const { deliverSignedWebhook } = require('../../../../shared/webhookSender');
const { createLogger } = require('../../../../shared/logger');

const log = createLogger('worker-webhooks');

async function handleWebhookDispatch(jobPayload) {
  const { envMode, merchantId, eventType, data } = jobPayload;
  const endpoints = await db.query(
    `SELECT * FROM webhook_endpoints
     WHERE env_mode = $1 AND active = TRUE AND (merchant_id = $2 OR merchant_id = 'merch_default')`,
    [envMode, merchantId || 'merch_default']
  );

  for (const ep of endpoints.rows) {
    await deliverSignedWebhook({
      endpointId: ep.id,
      envMode,
      eventType,
      targetUrl: ep.target_url,
      secret: ep.signing_secret,
      payload: {
        id: `evt_${Date.now()}`,
        type: eventType,
        env_mode: envMode,
        created: new Date().toISOString(),
        data
      }
    });
  }
  log.info('Dispatched event to subscribed merchant endpoints', {
    eventType,
    endpointCount: endpoints.rows.length
  });
}

async function handleWebhookReplay(jobPayload) {
  await deliverSignedWebhook({
    endpointId: jobPayload.endpointId,
    envMode: jobPayload.envMode,
    eventType: jobPayload.eventType,
    targetUrl: jobPayload.targetUrl,
    secret: jobPayload.secret,
    payload: jobPayload.payload,
    existingDeliveryId: jobPayload.deliveryId
  });
}

module.exports = { handleWebhookDispatch, handleWebhookReplay };
