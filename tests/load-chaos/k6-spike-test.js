import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 30 },  // Ramp up traffic spike (Black Friday simulation)
    { duration: '40s', target: 80 },  // Sustained peak load to trigger ECS/HPA auto-scaling
    { duration: '20s', target: 0 }    // Scale down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500']
  }
};

const BASE_URL = __ENV.ALB_URL || 'http://payops-alb-411713481.eu-north-1.elb.amazonaws.com';

export default function () {
  const payload = JSON.stringify({
    customer_name: 'Load Test Buyer',
    customer_email: 'loadtest@payops.internal',
    amount_cents: 2500,
    currency: 'USD',
    description: 'k6 Flash Sale Spike'
  });

  const res = http.post(`${BASE_URL}/api/payments`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-PayOps-Mode': 'test' }
  });

  check(res, {
    'checkout status is 201': (r) => r.status === 201
  });
  sleep(0.2);
}
