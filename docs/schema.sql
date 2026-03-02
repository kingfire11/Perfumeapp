CREATE TYPE user_role AS ENUM ('OWNER', 'MANAGER', 'EMPLOYEE');
CREATE TYPE commission_type AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE expense_category AS ENUM ('OIL', 'BASE', 'BOTTLE', 'PACKAGING', 'MARKETING', 'RENT', 'OTHER');

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'EMPLOYEE',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sales_points (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  commission_type commission_type NOT NULL,
  commission_value NUMERIC(12,2) NOT NULL,
  bottle_sale_price NUMERIC(12,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_central BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  aroma_name TEXT NOT NULL,
  volume_ml INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE batch_costs (
  id SERIAL PRIMARY KEY,
  oil_ml NUMERIC(12,2) NOT NULL,
  base_ml NUMERIC(12,2) NOT NULL,
  oil_price NUMERIC(12,2) NOT NULL,
  base_price NUMERIC(12,2) NOT NULL,
  bottle_price NUMERIC(12,2) NOT NULL,
  packaging_price NUMERIC(12,2) NOT NULL,
  other_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  yielded_bottles INT NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventories (
  id SERIAL PRIMARY KEY,
  point_id INT NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 0,
  UNIQUE (point_id, product_id)
);

CREATE TABLE supplies (
  id SERIAL PRIMARY KEY,
  point_id INT NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  comment TEXT
);

CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  point_id INT NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  quantity_sold INT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  sale_amount NUMERIC(12,2) NOT NULL,
  point_commission NUMERIC(12,2) NOT NULL,
  gross_profit NUMERIC(12,2) NOT NULL,
  net_profit NUMERIC(12,2) NOT NULL
);

CREATE TABLE cash_collections (
  id SERIAL PRIMARY KEY,
  point_id INT NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  period TEXT NOT NULL,
  comment TEXT
);

CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  category expense_category NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  comment TEXT
);

CREATE TABLE action_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_date ON sales(date);
CREATE INDEX idx_sales_points_active ON sales_points(is_active);
CREATE INDEX idx_products_active ON products(is_active);
