#!/usr/bin/env bash
# Troubleshoot any individual JS feature in isolation after AWS deployment!
# Usage: ./scripts/troubleshoot-feature.sh <payments|invoices|billing|webhooks|telemetry|database|queue>
set -euo pipefail

FEATURE="${1:-payments}"
BASE_URL="${ALB_URL:-http://payops-alb-411713481.eu-north-1.elb.amazonaws.com}"
LOG_GROUP="${CW_LOG_GROUP:-/ecs/payops-task}"
AWS_REGION="${AWS_REGION:-eu-north-1}"

echo "============================================================"
echo " PayOps Individual Feature Diagnostics: [${FEATURE}]"
echo "============================================================"

if [[ "${FEATURE}" =~ ^(payments|invoices|billing|webhooks)$ ]]; then
  echo "[1/3] Probing isolated health endpoint: ${BASE_URL}/api/${FEATURE}/health"
  curl -i -s "${BASE_URL}/api/${FEATURE}/health" || true
  echo -e "\n"
else
  echo "[1/3] Probing live status telemetry: ${BASE_URL}/status"
  curl -s "${BASE_URL}/status" | head -c 600 || true
  echo -e "\n"
fi

echo "[2/3] Querying recent CloudWatch structured logs for feature='${FEATURE}'..."
if command -v aws >/dev/null 2>&1; then
  aws logs filter-log-events \
    --region "${AWS_REGION}" \
    --log-group-name "${LOG_GROUP}" \
    --filter-pattern "{ \$.feature = \"${FEATURE}*\" }" \
    --limit 20 \
    --query 'events[*].message' \
    --output text || echo "CloudWatch query skipped (check AWS credentials)."
else
  echo "AWS CLI not installed locally; run: docker compose logs api worker | grep '"feature":"${FEATURE}'"
fi

echo "[3/3] Local code path to inspect for [${FEATURE}]:"
echo "  -> API Route/Controller : services/api/src/features/${FEATURE}/routes.js"
echo "  -> Async Worker Handler : services/worker/src/handlers/"
