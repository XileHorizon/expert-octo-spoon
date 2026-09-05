-- Ship Print eSell — rerunnable MySQL 8 schema.
-- Apply with `npm run db:init`; do not put credentials on the command line.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS owners (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  email VARCHAR(320) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY owners_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash CHAR(64) NOT NULL,
  owner_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY owner_sessions_owner_idx (owner_id),
  KEY owner_sessions_expiry_idx (expires_at),
  CONSTRAINT owner_sessions_owner_fk FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS owner_password_resets (
  token_hash CHAR(64) NOT NULL,
  owner_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY owner_resets_owner_idx (owner_id),
  KEY owner_resets_expiry_idx (expires_at),
  CONSTRAINT owner_resets_owner_fk FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  minimum_quantity INT NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sizes (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  product_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  dimensions VARCHAR(255) NULL,
  base_price DECIMAL(14,4) NULL CHECK (base_price IS NULL OR base_price >= 0),
  billing_unit ENUM('printed_page','piece','card','job') NOT NULL DEFAULT 'printed_page',
  minimum_quantity INT NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  manual_quote BOOLEAN NOT NULL DEFAULT FALSE,
  included_note TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY sizes_product_idx (product_id),
  CONSTRAINT sizes_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS materials (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  product_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit_price DECIMAL(14,4) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  weight VARCHAR(100) NULL,
  category VARCHAR(255) NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY materials_product_idx (product_id),
  CONSTRAINT materials_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_sizes (
  material_id CHAR(36) NOT NULL,
  size_id CHAR(36) NOT NULL,
  PRIMARY KEY (material_id, size_id),
  CONSTRAINT material_sizes_material_fk FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  CONSTRAINT material_sizes_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS size_papers (
  size_id CHAR(36) NOT NULL,
  material_id CHAR(36) NOT NULL,
  surcharge DECIMAL(14,4) NULL CHECK (surcharge IS NULL OR surcharge >= 0),
  is_standard BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (size_id, material_id),
  KEY size_papers_material_idx (material_id),
  CONSTRAINT size_papers_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE,
  CONSTRAINT size_papers_material_fk FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bulk_tiers (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  product_id CHAR(36) NULL,
  min_quantity INT NOT NULL CHECK (min_quantity > 0),
  unit_price DECIMAL(14,4) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  discount_percent DECIMAL(5,2) NULL CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  quantity_basis ENUM('printed_pages','pieces') NOT NULL DEFAULT 'printed_pages',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY bulk_tiers_product_quantity_unique (product_id, min_quantity),
  CONSTRAINT bulk_tiers_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bulk_tier_sizes (
  tier_id CHAR(36) NOT NULL,
  size_id CHAR(36) NOT NULL,
  PRIMARY KEY (tier_id, size_id),
  CONSTRAINT bulk_tier_sizes_tier_fk FOREIGN KEY (tier_id) REFERENCES bulk_tiers(id) ON DELETE CASCADE,
  CONSTRAINT bulk_tier_sizes_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS finishing_options (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  unit_price DECIMAL(14,4) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  charge_basis ENUM('per_piece','per_printed_page','flat_per_job') NOT NULL DEFAULT 'per_piece',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS finishing_sizes (
  finishing_id CHAR(36) NOT NULL,
  size_id CHAR(36) NOT NULL,
  PRIMARY KEY (finishing_id, size_id),
  CONSTRAINT finishing_sizes_option_fk FOREIGN KEY (finishing_id) REFERENCES finishing_options(id) ON DELETE CASCADE,
  CONSTRAINT finishing_sizes_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fulfillment_options (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  flat_price DECIMAL(14,4) NULL CHECK (flat_price IS NULL OR flat_price >= 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quote_requests (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  idempotency_key CHAR(36) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(320) NOT NULL,
  organization VARCHAR(255) NULL,
  phone VARCHAR(100) NULL,
  fulfillment_id CHAR(36) NULL,
  fulfillment_name VARCHAR(255) NULL,
  pricing_status ENUM('priced','manual') NOT NULL,
  calculated_total DECIMAL(14,2) NULL,
  status ENUM('received','intake_failed','reviewing','quoted','closed') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY quote_requests_idempotency_unique (idempotency_key),
  KEY quote_requests_created_idx (created_at DESC),
  KEY quote_requests_status_idx (status),
  CONSTRAINT quote_requests_fulfillment_fk FOREIGN KEY (fulfillment_id) REFERENCES fulfillment_options(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quote_jobs (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  quote_request_id CHAR(36) NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  file_name VARCHAR(1024) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  mime_type VARCHAR(255) NOT NULL,
  page_count INT NULL CHECK (page_count IS NULL OR page_count > 0),
  product_id VARCHAR(255) NOT NULL,
  size_id VARCHAR(255) NOT NULL,
  material_id VARCHAR(255) NOT NULL,
  product_name VARCHAR(255) NULL,
  size_name VARCHAR(255) NULL,
  material_name VARCHAR(255) NULL,
  finishing_names JSON NOT NULL DEFAULT (JSON_ARRAY()),
  custom_width DECIMAL(12,3) NULL,
  custom_height DECIMAL(12,3) NULL,
  custom_units ENUM('in','cm','mm') NULL,
  color_mode ENUM('color','black-white') NOT NULL DEFAULT 'color',
  orientation ENUM('portrait','landscape') NOT NULL DEFAULT 'portrait',
  quantity INT NOT NULL CHECK (quantity > 0),
  sides INT NOT NULL CHECK (sides IN (1,2)),
  finishing_ids JSON NOT NULL DEFAULT (JSON_ARRAY()),
  notes TEXT NULL,
  storage_path VARCHAR(768) NULL,
  pricing_status ENUM('priced','manual') NOT NULL,
  calculated_subtotal DECIMAL(14,2) NULL,
  pricing_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY quote_jobs_storage_unique (storage_path),
  KEY quote_jobs_request_idx (quote_request_id),
  KEY quote_jobs_product_history_idx (product_id),
  KEY quote_jobs_size_history_idx (size_id),
  KEY quote_jobs_material_history_idx (material_id),
  CONSTRAINT quote_jobs_request_fk FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS email_deliveries (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  quote_request_id CHAR(36) NOT NULL,
  status ENUM('not_configured','queued','provider_accepted','failed') NOT NULL,
  provider_message_id VARCHAR(1024) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY email_deliveries_request_idx (quote_request_id),
  CONSTRAINT email_deliveries_request_fk FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS business_settings (
  id TINYINT NOT NULL DEFAULT 1 CHECK (id = 1),
  contact_phone VARCHAR(100) NOT NULL DEFAULT '',
  contact_email VARCHAR(320) NOT NULL DEFAULT '',
  turnaround_intro TEXT NOT NULL,
  standard_turnaround TEXT NOT NULL,
  rush_turnaround TEXT NOT NULL,
  support_copy TEXT NOT NULL,
  notification_target VARCHAR(320) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NULL,
  PRIMARY KEY (id),
  CONSTRAINT business_settings_owner_fk FOREIGN KEY (updated_by) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO business_settings
  (id, contact_phone, contact_email, turnaround_intro, standard_turnaround, rush_turnaround, support_copy)
VALUES (1, '', '', '', '', '', 'Need help?');

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id CHAR(36) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NULL,
  details JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY admin_activity_owner_idx (owner_id),
  CONSTRAINT admin_activity_owner_fk FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
