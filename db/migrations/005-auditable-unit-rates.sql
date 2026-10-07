-- Auditable unit-rate dimensions and explicit automatic-quote ceilings.
-- Rerunnable on MySQL 8; existing owner-entered prices remain unchanged.

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sizes' AND column_name='max_auto_quote_quantity')=0,
  'ALTER TABLE sizes ADD COLUMN max_auto_quote_quantity INT NULL AFTER minimum_quantity', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sizes' AND column_name='manual_quote_message')=0,
  'ALTER TABLE sizes ADD COLUMN manual_quote_message VARCHAR(500) NULL AFTER manual_quote', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND column_name='material_id')=0,
  'ALTER TABLE bulk_tiers ADD COLUMN material_id CHAR(36) NULL AFTER quantity_basis', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND column_name='color_mode')=0,
  'ALTER TABLE bulk_tiers ADD COLUMN color_mode ENUM(''color'',''black-white'') NULL AFTER material_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND column_name='sides')=0,
  'ALTER TABLE bulk_tiers ADD COLUMN sides TINYINT NULL AFTER color_mode', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Add the replacement product index before dropping the old unique index because
-- InnoDB uses the leading product_id column to support the existing foreign key.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND index_name='bulk_tiers_product_quantity_idx')=0,
  'ALTER TABLE bulk_tiers ADD INDEX bulk_tiers_product_quantity_idx(product_id,min_quantity)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND index_name='bulk_tiers_product_quantity_unique')>0,
  'ALTER TABLE bulk_tiers DROP INDEX bulk_tiers_product_quantity_unique', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='bulk_tiers' AND index_name='bulk_tiers_material_idx')=0,
  'ALTER TABLE bulk_tiers ADD INDEX bulk_tiers_material_idx(material_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='bulk_tiers' AND constraint_name='bulk_tiers_material_fk')=0,
  'ALTER TABLE bulk_tiers ADD CONSTRAINT bulk_tiers_material_fk FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(100) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO schema_migrations(id) VALUES ('005-auditable-unit-rates-data');
SET @apply_005_data = ROW_COUNT();

-- Upgrade only known starter rows once. Later owner edits survive db:init reruns.
UPDATE size_papers SET surcharge=0.10
WHERE @apply_005_data=1
  AND size_id='20000000-0000-4000-8000-000000000001'
  AND material_id IN ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004')
  AND surcharge=0;
UPDATE sizes SET manual_quote=TRUE, manual_quote_message=COALESCE(manual_quote_message,'Pricing will be sent for approval.')
WHERE @apply_005_data=1 AND id='20000000-0000-4000-8000-000000000006';
