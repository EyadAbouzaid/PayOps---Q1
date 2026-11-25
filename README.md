# Standalone E-Commerce Platform (PayOps Integrated)

Microservices-based B2C E-commerce storefront integrated with the PayOps Payment Orchestration API per `payops-contract.pdf`.

## Services & Default Ports
- **Frontend (`frontend/`)**: `http://localhost:5173`
- **Order Service (`services/order-service/`)**: `http://localhost:4001` (hosts `PaymentClient` & `POST /api/webhooks/payments`)
- **Product Service (`services/product-service/`)**: `http://localhost:4002`
- **Cart Service (`services/cart-service/`)**: `http://localhost:4003`
- **Auth Service (`services/auth-service/`)**: `http://localhost:4004`
- **Search Service (`services/search-service/`)**: `http://localhost:4005`
- **PayOps Mock (`services/payops-mock/`)**: `http://localhost:3005`
- **PostgreSQL 16**: Host port `5433` -> Container `5432`
- **Redis 7**: Host port `6380` -> Container `6379`
- **Prometheus**: Host port `9091` -> Container `9090`

## Quick Start
```bash
cp .env.example .env
docker compose up -d --build
node scripts/smoke-test.js
```

## Assumptions (Rule 10)
1. **Webhook Endpoint Registration**: In production, `POST /api/webhooks/endpoints` is registered once per merchant environment with PayOps, and `PAYOPS_WEBHOOK_SECRET` is stored in Kubernetes Secrets. `payops-mock` pre-registers `ORDER_WEBHOOK_CALLBACK_URL` automatically on startup.
2. **Webhook Timestamp Replay Window**: `payops-contract.pdf` specifies rejecting "unexpectedly old" timestamps; this implementation enforces a strict ±300 second (5-minute) window per MVP Rule 5.
3. **Synchronous vs. Asynchronous Payment Outcomes**: `POST /api/payments` returns HTTP 201 synchronously with `intent.status`. If `intent.status` is `processing` or `requires_capture`, the order remains `PENDING_PAYMENT` until either the `payment.succeeded`/`payment.failed` webhook arrives or the 2-minute reconciliation job polls `GET /api/payments/:id`.
4. **Pending Order Timeout**: Orders stuck in `PENDING_PAYMENT` beyond `PENDING_ORDER_TIMEOUT_MINUTES` (default 30 minutes) are automatically transitioned to `CANCELLED` during the reconciliation cycle.
5. **Cancellation Refunds**: Transitioning a `PAID` order to `CANCELLED` via `PATCH /api/orders/:id/status` triggers a full refund via `PaymentClient.refund(intentId)`.
6. **Partially Captured Status Mapping**: `payops-contract.pdf` lists `partially_captured` as a valid intermediate/manual PaymentIntent state; `PaymentClient` maps `partially_captured -> PENDING_PAYMENT` until full capture completes (`succeeded -> PAID`).
