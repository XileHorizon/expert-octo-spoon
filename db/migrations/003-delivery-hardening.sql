-- Durable owner-reset outbox and authoritative email-delivery ordering.
-- Rerunnable on MySQL 8. Existing email rows are retained and receive a
-- deterministic sequence ordered by creation time and UUID for legacy ties.

CREATE TABLE IF NOT EXISTS owner_password_reset_deliveries (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  owner_id CHAR(36) NOT NULL,
  status ENUM('queued','processing','delivered','failed') NOT NULL DEFAULT 'queued',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_until DATETIME(3) NULL,
  provider_message_id VARCHAR(1024) NULL,
  last_error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY owner_reset_deliveries_ready_idx (status, available_at),
  KEY owner_reset_deliveries_owner_idx (owner_id),
  CONSTRAINT owner_reset_deliveries_owner_fk FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND column_name='attempt_sequence')=0,
  'ALTER TABLE email_deliveries ADD COLUMN attempt_sequence BIGINT UNSIGNED NULL AFTER quote_request_id',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE email_deliveries e
JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS seq
  FROM email_deliveries
) ranked ON ranked.id=e.id
SET e.attempt_sequence=ranked.seq
WHERE e.attempt_sequence IS NULL;

SET @sql = IF(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND column_name='attempt_sequence')='YES',
  'ALTER TABLE email_deliveries MODIFY attempt_sequence BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND index_name='email_deliveries_attempt_unique')=0,
  'ALTER TABLE email_deliveries ADD UNIQUE KEY email_deliveries_attempt_unique (attempt_sequence)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT extra FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='email_deliveries' AND column_name='attempt_sequence') NOT LIKE '%auto_increment%',
  'ALTER TABLE email_deliveries MODIFY attempt_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
