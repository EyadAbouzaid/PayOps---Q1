pipeline {
  agent any

  environment {
    COMPOSE_PROJECT_NAME = "ecommerce_ci_${BUILD_NUMBER}"
  }

  stages {
    stage('Unit Tests') {
      steps {
        sh '''
          for svc in services/order-service services/auth-service services/product-service services/search-service services/cart-service; do
            docker run --rm -v "$PWD/$svc:/app" -w /app node:20-alpine sh -c "npm install --omit=dev && npm test"
          done
        '''
      }
    }

    stage('Start Stack via Docker Compose') {
      steps {
        sh 'docker compose up -d --build --wait'
      }
    }

    stage('Integration Smoke & Scenario Tests') {
      steps {
        sh '''
          docker run --rm --network host -v "$PWD:/work" -w /work node:20-alpine node scripts/smoke-test.js
          docker run --rm --network host -v "$PWD:/work" -w /work node:20-alpine node --test tests/integration/scenarios.test.js
        '''
      }
    }

    stage('Playwright E2E Tests') {
      steps {
        sh '''
          docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.46.0-jammy sh -c "npm install && npx playwright test"
        '''
      }
    }
  }

  post {
    always {
      sh 'docker compose down -v --remove-orphans || true'
    }
  }
}
