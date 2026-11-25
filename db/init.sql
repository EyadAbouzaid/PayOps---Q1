CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) UNIQUE NOT NULL,
  slug VARCHAR(150) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  image_url TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

CREATE TABLE IF NOT EXISTS carts (
  user_id VARCHAR(255) PRIMARY KEY,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_intent_id VARCHAR(255) UNIQUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_intent_id ON orders(payment_intent_id);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  delivery_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  intent_id VARCHAR(255),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (id, name, slug, description) VALUES
  ('11111111-1111-1111-1111-111111111101', 'Cloud & DevOps Hardware', 'cloud-devops-hardware', 'Servers, edge routers, and hardware security keys'),
  ('11111111-1111-1111-1111-111111111102', 'Developer Workstations', 'developer-workstations', 'Keyboards, monitors, and workstation accessories'),
  ('11111111-1111-1111-1111-111111111103', 'SaaS & Cloud Credits', 'saas-cloud-credits', 'Enterprise licenses and infrastructure credits')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (id, category_id, name, description, price_cents, stock_quantity, image_url) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'Hardware Security Key YubiPro', 'FIDO2 U2F USB-C hardware authentication key for zero-trust SSH and AWS IAM', 5500, 100, 'https://placehold.co/400x300?text=YubiPro+Key'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111102', 'Mechanical Split Keyboard K8', 'Ergonomic programmable mechanical keyboard with QMK/VIA firmware', 18900, 50, 'https://placehold.co/400x300?text=Split+Keyboard'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111102', '4K USB-C Docking Monitor 27"', 'IPS 4K developer display with 90W USB-C power delivery and KVM switch', 49900, 30, 'https://placehold.co/400x300?text=4K+Monitor'),
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111103', 'Enterprise Kubernetes Cluster Pack', 'Managed multi-AZ Kubernetes control plane voucher ($300.00 value)', 30000, 200, 'https://placehold.co/400x300?text=K8s+Cluster+Pack'),
  ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111101', 'Edge Gateway Mini Server', 'Low-power ARM64 edge node with dual 2.5GbE NICs and NVMe slot', 24900, 40, 'https://placehold.co/400x300?text=Edge+Server')
ON CONFLICT (id) DO NOTHING;
