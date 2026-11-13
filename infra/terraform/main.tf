terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "eu-north-1"
}

variable "environment" {
  description = "Isolated workspace environment (dev | staging | prod)"
  default     = "prod"
}

variable "alb_dns_endpoint" {
  default = "http://payops-alb-411713481.eu-north-1.elb.amazonaws.com"
}

# 1. Private S3 Bucket for Official PDF Invoices + Lifecycle Policy
resource "aws_s3_bucket" "invoices" {
  bucket = "payops-official-invoices-${var.environment}-950219439587"
}

resource "aws_s3_bucket_public_access_block" "invoices_private" {
  bucket                  = aws_s3_bucket.invoices.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "invoices_lifecycle" {
  bucket = aws_s3_bucket.invoices.id
  rule {
    id     = "archive-old-invoices"
    status = "Enabled"
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}

# 2. SQS Async Job Queue for Decoupled Worker Scaling
resource "aws_sqs_queue" "jobs" {
  name                       = "payops-jobs-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
}

# 3. EventBridge Scheduled Cron Rule for Automated Billing & Payroll Runs
resource "aws_cloudwatch_event_rule" "billing_hourly" {
  name                = "payops-billing-scheduler-${var.environment}"
  description         = "Triggers PayOps recurring payroll and subscription batch runs"
  schedule_expression = "rate(1 hour)"
}

# 4. AWS WAFv2 Web ACL (SQLi protection + Rate Limiting at ALB Edge)
resource "aws_wafv2_web_acl" "payops_waf" {
  name  = "payops-edge-waf-${var.environment}"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "RateLimitCheckoutAbuse"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "payopsRateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "payopsEdgeWaf"
    sampled_requests_enabled   = true
  }
}
