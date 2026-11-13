# PayOps (Q1 Stage) — High-Reliability Payment, Billing & Invoicing Engine

Built on top of the existing `MohamedTantawey/PayOps` AWS (`eu-north-1`) architecture (`payops-alb` -> `payops-fargate` -> `payops-db` RDS PostgreSQL + ECR + Jenkins CI/CD), expanded with decoupled feature modules, async worker queues, S3 PDF pre-signed invoicing, payroll cron scheduling, HMAC-SHA256 webhooks with manual replay, OpenAPI sandbox, and Prometheus/Grafana observability.

## Quick Start (Local Multi-Container Stack)
```bash
cp .env.example .env
docker compose up --build -d
# Control Plane UI: http://localhost:3000 (or via Nginx on http://localhost:8080)
# OpenAPI Sandbox : http://localhost:3000/api-docs
# Grafana         : http://localhost:3002 (admin / admin)
```

## Individual Feature Troubleshooting After Deployment
Every JS capability is isolated by route, health probe, and CloudWatch JSON `feature` tag:
```bash
chmod +x scripts/troubleshoot-feature.sh
./scripts/troubleshoot-feature.sh payments
./scripts/troubleshoot-feature.sh invoices
./scripts/troubleshoot-feature.sh billing
./scripts/troubleshoot-feature.sh webhooks
```
