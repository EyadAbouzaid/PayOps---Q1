module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'PayOps Q1 Payment, Billing & Invoicing Engine API',
    version: '1.1.0',
    description: 'Interactive developer sandbox & live API platform. Pass header `X-PayOps-Mode: test` (default) or `live` to isolate environments.'
  },
  servers: [{ url: '/', description: 'Current ALB / Local Gateway' }],
  paths: {
    '/status': {
      get: {
        tags: ['Telemetry'],
        summary: 'Live Infrastructure Telemetry (Container Host, AWS AZ, Commit SHA, Build #, RDS Ping)',
        responses: { '200': { description: 'Live infrastructure metadata' } }
      }
    },
    '/health': {
      get: {
        tags: ['Telemetry'],
        summary: 'ALB Target Group Health Check Probe',
        responses: { '200': { description: 'Healthy' }, '503': { description: 'Unhealthy' } }
      }
    },
    '/api/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List recent payments for active environment mode',
        parameters: [{ name: 'X-PayOps-Mode', in: 'header', schema: { type: 'string', enum: ['test', 'live'], default: 'test' } }],
        responses: { '200': { description: 'Payments list' } }
      },
      post: {
        tags: ['Payments'],
        summary: 'Process checkout payment & enqueue async S3 PDF invoice + signed webhook',
        parameters: [{ name: 'X-PayOps-Mode', in: 'header', schema: { type: 'string', enum: ['test', 'live'], default: 'test' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount_cents', 'customer_email'],
                properties: {
                  customer_name: { type: 'string', example: 'Eyad Adel' },
                  customer_email: { type: 'string', example: 'eyad@example.com' },
                  amount_cents: { type: 'integer', example: 12500 },
                  currency: { type: 'string', example: 'USD' },
                  description: { type: 'string', example: 'Cloud Pro Plan' },
                  idempotency_key: { type: 'string', example: 'idem_demo_001' }
                }
              }
            }
          }
        },
        responses: { '201': { description: 'Payment processed' } }
      }
    },
    '/api/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List generated official PDF invoices',
        responses: { '200': { description: 'Invoices list' } }
      }
    },
    '/api/invoices/{id}/download-url': {
      get: {
        tags: ['Invoices'],
        summary: 'Generate time-limited S3 Pre-Signed download URL for PDF invoice',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Pre-signed URL' } }
      }
    },
    '/api/billing/schedules': {
      get: { tags: ['Billing & Payroll'], summary: 'List recurring payroll & subscription schedules', responses: { '200': { description: 'Schedules' } } },
      post: {
        tags: ['Billing & Payroll'],
        summary: 'Create recurring payroll or subscription schedule',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'recipient_email', 'amount_cents'],
                properties: {
                  schedule_type: { type: 'string', enum: ['payroll', 'subscription'], example: 'payroll' },
                  name: { type: 'string', example: 'DevOps Contractor Payout' },
                  recipient_email: { type: 'string', example: 'contractor@example.com' },
                  amount_cents: { type: 'integer', example: 85000 },
                  currency: { type: 'string', example: 'USD' }
                }
              }
            }
          }
        },
        responses: { '201': { description: 'Schedule created' } }
      }
    },
    '/api/billing/run-due': {
      post: {
        tags: ['Billing & Payroll'],
        summary: 'Trigger due payroll & subscription runs asynchronously (EventBridge / Manual)',
        responses: { '200': { description: 'Queued due schedules' } }
      }
    },
    '/api/webhooks/deliveries': {
      get: { tags: ['Webhooks'], summary: 'Inspect signed webhook delivery audit logs', responses: { '200': { description: 'Deliveries list' } } }
    },
    '/api/webhooks/deliveries/{id}/replay': {
      post: {
        tags: ['Webhooks'],
        summary: 'One-click manual replay for a failed or historical webhook notification',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Replay queued' } }
      }
    }
  }
};
