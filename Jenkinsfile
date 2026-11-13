pipeline {
    agent any

    environment {
        AWS_REGION      = 'eu-north-1'
        AWS_ACCOUNT_ID  = '950219439587'
        ECR_REGISTRY    = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        ECR_REPO        = 'payops'
        ECS_CLUSTER     = 'payops-cluster'
        ECS_SERVICE     = 'payops-app'
        ALB_URL         = 'http://payops-alb-411713481.eu-north-1.elb.amazonaws.com'
        GIT_SHA_SHORT   = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(8) : 'manual'}"
        IMAGE_TAG       = "sha-${GIT_SHA_SHORT}-b${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout & Static Checks') {
            steps {
                sh 'node --version'
                sh 'npm ci'
                sh 'npm test'
            }
        }

        stage('Build Immutable Container Image') {
            steps {
                sh """
                  docker build \
                    --build-arg GIT_COMMIT_SHA=${GIT_SHA_SHORT} \
                    --build-arg JENKINS_BUILD_NUMBER=${env.BUILD_NUMBER} \
                    -t ${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG} \
                    -t ${ECR_REGISTRY}/${ECR_REPO}:latest .
                """
            }
        }

        stage('Push to Amazon ECR (eu-north-1)') {
            steps {
                sh """
                  aws ecr get-login-password --region ${AWS_REGION} | \
                    docker login --username AWS --password-stdin ${ECR_REGISTRY}
                  docker push ${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}
                  docker push ${ECR_REGISTRY}/${ECR_REPO}:latest
                """
            }
        }

        stage('Zero-Downtime ECS Fargate Rollout') {
            steps {
                sh 'chmod +x scripts/deploy.sh && ./scripts/deploy.sh'
            }
        }

        stage('Post-Deploy Smoke & Feature Health Verification') {
            steps {
                sh 'chmod +x scripts/smoke-test.sh && ALB_URL=${ALB_URL} ./scripts/smoke-test.sh'
            }
        }
    }

    post {
        failure {
            echo "Pipeline failed on build #${env.BUILD_NUMBER} (commit ${GIT_SHA_SHORT}). ECS Deployment Circuit Breaker keeps healthy tasks serving traffic."
        }
    }
}
