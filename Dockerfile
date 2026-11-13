# Multi-stage production Dockerfile (Compatible with existing ECS payops-task on Port 3000)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_COMMIT_SHA=unknown
ARG JENKINS_BUILD_NUMBER=0
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV JENKINS_BUILD_NUMBER=${JENKINS_BUILD_NUMBER}
ENV ENABLE_EMBEDDED_WORKER=true
ENV SERVE_STATIC_FRONTEND=true

RUN addgroup -S payops && adduser -S payops -G payops
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY shared ./shared
COPY db ./db
COPY services/api ./services/api
COPY services/worker ./services/worker
COPY services/frontend/public ./services/frontend/public

RUN mkdir -p /app/storage/invoices && chown -R payops:payops /app
USER payops

EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
