#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ALB_URL:-http://payops-alb-411713481.eu-north-1.elb.amazonaws.com}"
echo "[smoke-test] Running post-deploy checks against ${BASE_URL}"

for endpoint in "/health" "/status" "/api/payments/health" "/api/invoices/health" "/api/billing/health" "/api/webhooks/health" "/api-docs.json"; do
  printf "  -> Checking %-26s ... " "${endpoint}"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}")
  if [ "${HTTP_CODE}" != "200" ]; then
    echo "FAILED (HTTP ${HTTP_CODE})"
    exit 1
  fi
  echo "OK (200)"
done

echo "  -> Creating sandbox smoke-test payment..."
PAY_RESP=$(curl -sf -X POST "${BASE_URL}/api/payments" \
  -H "Content-Type: application/json" \
  -H "X-PayOps-Mode: test" \
  -d '{"customer_name":"CI Smoke Test","customer_email":"ci@payops.internal","amount_cents":100,"currency":"USD","description":"Jenkins Post-Deploy Verification"}')

echo "${PAY_RESP}" | grep -q '"status":"succeeded"'
echo "[smoke-test] All feature probes and sandbox transaction succeeded!"
