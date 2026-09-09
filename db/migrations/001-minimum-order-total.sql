-- Additive, rerunnable migration for installations created before minimum-order pricing.
SET @schema_name = DATABASE();

SELECT COUNT(*) INTO @has_minimum_order_total
FROM information_schema.columns
WHERE table_schema = @schema_name AND table_name = 'business_settings' AND column_name = 'minimum_order_total';
SET @statement = IF(
  @has_minimum_order_total = 0,
  'ALTER TABLE business_settings ADD COLUMN minimum_order_total DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (minimum_order_total >= 0) AFTER notification_target',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SELECT COUNT(*) INTO @has_calculated_subtotal
FROM information_schema.columns
WHERE table_schema = @schema_name AND table_name = 'quote_requests' AND column_name = 'calculated_subtotal';
SET @statement = IF(
  @has_calculated_subtotal = 0,
  'ALTER TABLE quote_requests ADD COLUMN calculated_subtotal DECIMAL(14,2) NULL AFTER calculated_total',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SELECT COUNT(*) INTO @has_minimum_order_adjustment
FROM information_schema.columns
WHERE table_schema = @schema_name AND table_name = 'quote_requests' AND column_name = 'minimum_order_adjustment';
SET @statement = IF(
  @has_minimum_order_adjustment = 0,
  'ALTER TABLE quote_requests ADD COLUMN minimum_order_adjustment DECIMAL(14,2) NULL AFTER calculated_subtotal',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
