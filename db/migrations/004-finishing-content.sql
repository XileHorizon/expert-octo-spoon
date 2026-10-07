-- Owner-editable finishing guidance and small DB-backed example images.
-- Rerunnable on MySQL 8; existing options and pricing remain unchanged.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='finishing_options' AND column_name='information_text')=0,
  'ALTER TABLE finishing_options ADD COLUMN information_text TEXT NULL AFTER name',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='finishing_options' AND column_name='image_alt')=0,
  'ALTER TABLE finishing_options ADD COLUMN image_alt VARCHAR(255) NULL AFTER information_text',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS finishing_option_images (
  finishing_id CHAR(36) NOT NULL,
  content_type ENUM('image/png','image/jpeg') NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  content_hash CHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (finishing_id),
  CONSTRAINT finishing_option_images_option_fk FOREIGN KEY (finishing_id) REFERENCES finishing_options(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
