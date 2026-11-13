#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-north-1}"
ECS_CLUSTER="${ECS_CLUSTER:-payops-cluster}"
ECS_SERVICE="${ECS_SERVICE:-payops-app}"
TASK_FAMILY="${TASK_FAMILY:-payops-task}"
ECR_IMAGE="${ECR_REGISTRY:-950219439587.dkr.ecr.eu-north-1.amazonaws.com}/${ECR_REPO:-payops}:${IMAGE_TAG:-latest}"

echo "[deploy] Fetching active Task Definition for ${TASK_FAMILY} in ${AWS_REGION}..."
CURRENT_TD=$(aws ecs describe-task-definition --task-definition "${TASK_FAMILY}" --region "${AWS_REGION}" --query 'taskDefinition')

NEW_TD=$(echo "${CURRENT_TD}" | jq --arg IMAGE "${ECR_IMAGE}" \
  --arg SHA "${GIT_SHA_SHORT:-manual}" \
  --arg BUILD "${BUILD_NUMBER:-0}" '
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
  | .containerDefinitions[0].image = $IMAGE
  | .containerDefinitions[0].environment = (
      (.containerDefinitions[0].environment // [])
      | map(select(.name != "GIT_COMMIT_SHA" and .name != "JENKINS_BUILD_NUMBER"))
      + [{"name": "GIT_COMMIT_SHA", "value": $SHA}, {"name": "JENKINS_BUILD_NUMBER", "value": $BUILD}]
    )
')

NEW_TD_ARN=$(aws ecs register-task-definition \
  --region "${AWS_REGION}" \
  --cli-input-json "${NEW_TD}" \
  --query 'taskDefinition.taskDefinitionArn' --output text)

echo "[deploy] Registered new revision: ${NEW_TD_ARN}"
aws ecs update-service \
  --region "${AWS_REGION}" \
  --cluster "${ECS_CLUSTER}" \
  --service "${ECS_SERVICE}" \
  --task-definition "${NEW_TD_ARN}" \
  --force-new-deployment >/dev/null

echo "[deploy] Waiting for ECS Fargate service stability (zero-downtime rollout)..."
aws ecs wait services-stable --region "${AWS_REGION}" --cluster "${ECS_CLUSTER}" --services "${ECS_SERVICE}"
echo "[deploy] Rollout succeeded!"
