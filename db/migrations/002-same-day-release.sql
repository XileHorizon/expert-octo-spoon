-- Rerunnable compatibility migration for delivery types, mode pricing, setup, and normalized workflow.
-- Existing rows are preserved and mapped before legacy status values are removed.

CREATE TABLE IF NOT EXISTS owner_setup_state (
  id TINYINT NOT NULL DEFAULT 1 CHECK (id = 1),
  completed_at DATETIME(3) NULL,
  owner_id CHAR(36) NULL,
  PRIMARY KEY (id),
  CONSTRAINT owner_setup_state_owner_fk FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT IGNORE INTO owner_setup_state(id) VALUES (1);
UPDATE owner_setup_state
   SET completed_at = COALESCE(completed_at, UTC_TIMESTAMP(3)),
       owner_id = COALESCE(owner_id, (SELECT id FROM owners ORDER BY created_at LIMIT 1))
 WHERE id = 1 AND EXISTS (SELECT 1 FROM owners);

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='business_settings' AND column_name='color_adjustment')=0,
  'ALTER TABLE business_settings ADD COLUMN color_adjustment DECIMAL(14,4) NOT NULL DEFAULT 0 CHECK (color_adjustment >= 0)', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='business_settings' AND column_name='black_white_adjustment')=0,
  'ALTER TABLE business_settings ADD COLUMN black_white_adjustment DECIMAL(14,4) NOT NULL DEFAULT 0 CHECK (black_white_adjustment >= 0)', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='business_settings' AND column_name='portrait_adjustment')=0,
  'ALTER TABLE business_settings ADD COLUMN portrait_adjustment DECIMAL(14,4) NOT NULL DEFAULT 0 CHECK (portrait_adjustment >= 0)', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='business_settings' AND column_name='landscape_adjustment')=0,
  'ALTER TABLE business_settings ADD COLUMN landscape_adjustment DECIMAL(14,4) NOT NULL DEFAULT 0 CHECK (landscape_adjustment >= 0)', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quote_jobs' AND column_name='color_adjustment')=0,
  'ALTER TABLE quote_jobs ADD COLUMN color_adjustment DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER calculated_subtotal', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='quote_jobs' AND column_name='orientation_adjustment')=0,
  'ALTER TABLE quote_jobs ADD COLUMN orientation_adjustment DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER color_adjustment', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND column_name='delivery_type')=0,
  "ALTER TABLE email_deliveries ADD COLUMN delivery_type ENUM('shop_notification','customer_confirmation') NOT NULL DEFAULT 'shop_notification' AFTER quote_request_id", 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND column_name='recipient')=0,
  'ALTER TABLE email_deliveries ADD COLUMN recipient VARCHAR(320) NULL AFTER delivery_type', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND index_name='email_deliveries_request_type_idx')=0,
  'ALTER TABLE email_deliveries ADD KEY email_deliveries_request_type_idx (quote_request_id, delivery_type)', 'SELECT 1'); PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE quote_requests MODIFY status ENUM('received','intake_failed','reviewing','quoted','closed','request_received','quote_sent','in_progress','awaiting_payment','fulfilled') NOT NULL DEFAULT 'request_received';
UPDATE quote_requests SET status = CASE status
  WHEN 'received' THEN 'request_received'
  WHEN 'intake_failed' THEN 'request_received'
  WHEN 'reviewing' THEN 'in_progress'
  WHEN 'quoted' THEN 'quote_sent'
  WHEN 'closed' THEN 'fulfilled'
  ELSE status END;
ALTER TABLE quote_requests MODIFY status ENUM('request_received','quote_sent','in_progress','awaiting_payment','fulfilled') NOT NULL DEFAULT 'request_received';
