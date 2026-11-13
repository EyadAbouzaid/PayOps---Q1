FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_COMMIT_SHA=unknown
ARG JENKINS_BUILD_NUMBER=0
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV JENKINS_BUILD_NUMBER=${JENKINS_BUILD_NUMBER}
ENV SERVICE_NAME=payops-api
ENV ENABLE_EMBEDDED_WORKER=false

RUN addgroup -S payops && adduser -S payops -G payops
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY db ./db
COPY services/api ./services/api
COPY services/frontend/public ./services/frontend/public

RUN mkdir -p /app/storage/invoices && chown -R payops:payops /app
USER payops
EXPOSE 3000
CMD ["node", "services/api/src/index.js"]
