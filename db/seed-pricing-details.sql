-- Enrich the required starter catalog for the owner pricing portal.
-- Safe to re-run. Changes only known seed rows/empty fields; prices are never overwritten.

update sizes set name='Letter', dimensions='8.5 × 11', billing_unit='printed_page', included_note=coalesce(included_note,'Included: Standard 20 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000001' and name in ('8.5 × 11 — Letter','Letter');
update sizes set name='Legal', dimensions='8.5 × 14', billing_unit='printed_page', included_note=coalesce(included_note,'Included: Standard 22 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000002' and name in ('8.5 × 14 — Legal','Legal');
update sizes set name='Tabloid', dimensions='11 × 17', billing_unit='printed_page', included_note=coalesce(included_note,'Included: Standard 30 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000003' and name in ('11 × 17 — Tabloid','Tabloid');
update sizes set name='Poster', dimensions='18 × 24', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000004' and name in ('18 × 24 — Poster','Poster');
update sizes set name='Large Poster', dimensions='24 × 36', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000005' and name in ('24 × 36 — Large Poster','Large Poster');
update sizes set name='Business Cards', dimensions='3.5 × 2', billing_unit='card', minimum_quantity=greatest(minimum_quantity,200), included_note=coalesce(included_note,'Included: Standard business card stock')
where id='20000000-0000-4000-8000-000000000006' and name in ('3.5 × 2 — Business Cards','Business Cards');
update sizes set dimensions='Custom', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000007' and name='Custom';

update materials set name='Standard', weight=coalesce(weight,'20 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000001' and name in ('Standard 20 lb','Standard');
update materials set name='Premium Color', weight=coalesce(weight,'28 lb'), category=coalesce(category,'Smooth uncoated') where id='30000000-0000-4000-8000-000000000002' and name in ('Premium Color 28 lb','Premium Color');
update materials set name='Gloss Paper', weight=coalesce(weight,'27 lb'), category=coalesce(category,'Gloss coated') where id='30000000-0000-4000-8000-000000000003' and name in ('Gloss Paper 27 lb','Gloss Paper');
update materials set name='Cardstock', weight=coalesce(weight,'100 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000004' and name in ('Cardstock 100 lb','Cardstock');
update materials set name='Standard', weight=coalesce(weight,'22 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000005' and name in ('Standard 22 lb','Standard');
update materials set name='Standard', weight=coalesce(weight,'30 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000006' and name in ('Standard 30 lb','Standard');
update materials set name='Cardstock', weight=coalesce(weight,'80 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000007' and name in ('Cardstock 80 lb','Cardstock');
update materials set name='Business card stock', weight=coalesce(weight,'50 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000010' and name='50 lb';
update materials set name='Business card stock', weight=coalesce(weight,'100 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000011' and name='100 lb';

-- Mark the first mapped paper on each size as standard when none is marked.
UPDATE size_papers sp
JOIN (
  SELECT size_id, material_id
  FROM (
    SELECT size_id, material_id,
           ROW_NUMBER() OVER (PARTITION BY size_id ORDER BY sort_order, material_id) AS position,
           MAX(is_standard) OVER (PARTITION BY size_id) AS has_standard
    FROM size_papers
    WHERE active = TRUE
  ) ranked
  WHERE position = 1 AND has_standard = 0
) chosen ON chosen.size_id = sp.size_id AND chosen.material_id = sp.material_id
SET sp.is_standard = TRUE, sp.surcharge = COALESCE(sp.surcharge, 0);
