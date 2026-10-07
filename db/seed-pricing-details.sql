-- Enrich the required starter catalog for the owner pricing portal.
-- Safe to re-run. Changes only known seed rows/empty fields; prices are never overwritten.

update sizes set name='Letter', dimensions='8.5 × 11', billing_unit='printed_page', base_price=coalesce(base_price,0.12), included_note=coalesce(included_note,'Included: Standard 20 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000001' and name in ('8.5 × 11 — Letter','Letter');
update sizes set name='Legal', dimensions='8.5 × 14', billing_unit='printed_page', base_price=coalesce(base_price,0.17), included_note=coalesce(included_note,'Included: Standard 22 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000002' and name in ('8.5 × 14 — Legal','Legal');
update sizes set name='Tabloid', dimensions='11 × 17', billing_unit='printed_page', base_price=coalesce(base_price,0.25), included_note=coalesce(included_note,'Included: Standard 30 lb paper, black-and-white, single-sided')
where id='20000000-0000-4000-8000-000000000003' and name in ('11 × 17 — Tabloid','Tabloid');
update sizes set name='Poster', dimensions='18 × 24', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000004' and name in ('18 × 24 — Poster','Poster');
update sizes set name='Large Poster', dimensions='24 × 36', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000005' and name in ('24 × 36 — Large Poster','Large Poster');
update sizes set name='Business Cards', dimensions='3.5 × 2', billing_unit='card', minimum_quantity=greatest(minimum_quantity,200),
  included_note=coalesce(included_note,'Included: Standard business card stock')
where id='20000000-0000-4000-8000-000000000006' and name in ('3.5 × 2 — Business Cards','Business Cards');
update sizes set dimensions='Custom', billing_unit='piece', manual_quote=true
where id='20000000-0000-4000-8000-000000000007' and name='Custom';
update sizes set name='5 × 7 Cards', dimensions='5 × 7', billing_unit='card', base_price=coalesce(base_price,0.50), minimum_quantity=1
where id='20000000-0000-4000-8000-000000000008';
update sizes set name='4 × 6 Cards', dimensions='4 × 6', billing_unit='card', base_price=coalesce(base_price,0.50), minimum_quantity=1
where id='20000000-0000-4000-8000-000000000009';

update materials set name='Standard', weight=coalesce(weight,'20 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000001' and name in ('Standard 20 lb','Standard');
update materials set name='Premium Color', weight=coalesce(weight,'28 lb'), category=coalesce(category,'Smooth uncoated') where id='30000000-0000-4000-8000-000000000002' and name in ('Premium Color 28 lb','Premium Color');
update materials set name='Gloss Paper', weight=coalesce(weight,'27 lb'), category=coalesce(category,'Gloss coated') where id='30000000-0000-4000-8000-000000000003' and name in ('Gloss Paper 27 lb','Gloss Paper');
update materials set name='Cardstock', weight=coalesce(weight,'100 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000004' and name in ('Cardstock 100 lb','Cardstock');
update materials set name='Standard', weight=coalesce(weight,'22 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000005' and name in ('Standard 22 lb','Standard');
update materials set name='Standard', weight=coalesce(weight,'30 lb'), category=coalesce(category,'Uncoated') where id='30000000-0000-4000-8000-000000000006' and name in ('Standard 30 lb','Standard');
update materials set name='Cardstock', weight=coalesce(weight,'80 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000007' and name in ('Cardstock 80 lb','Cardstock');
update materials set name='Business card stock', weight=coalesce(weight,'50 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000010' and name='50 lb';
update materials set name='Business card stock', weight=coalesce(weight,'100 lb'), category=coalesce(category,'Cover stock') where id='30000000-0000-4000-8000-000000000011' and name='100 lb';
update materials set name='Card stock', category=coalesce(category,'Card') where id='30000000-0000-4000-8000-000000000013';

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

-- Stable, owner-editable exact rates. Re-running the seed never overwrites edits.
insert ignore into bulk_tiers(id,product_id,min_quantity,unit_price,discount_percent,quantity_basis,material_id,color_mode,sides,active,sort_order) values
('40000000-0000-4000-8000-000000000001',null,1,0.12,null,'printed_pages',null,'black-white',null,true,10),
('40000000-0000-4000-8000-000000000002',null,101,0.11,null,'printed_pages',null,'black-white',null,true,20),
('40000000-0000-4000-8000-000000000003',null,501,0.10,null,'printed_pages',null,'black-white',null,true,30),
('40000000-0000-4000-8000-000000000004',null,2001,0.09,null,'printed_pages',null,'black-white',null,true,40),
('40000000-0000-4000-8000-000000000005',null,1,0.55,null,'printed_pages',null,'color',null,true,50),
('40000000-0000-4000-8000-000000000006',null,100,0.50,null,'printed_pages',null,'color',null,true,60),
('40000000-0000-4000-8000-000000000007',null,500,0.40,null,'printed_pages',null,'color',null,true,70),
('40000000-0000-4000-8000-000000000008',null,1,0.17,null,'printed_pages',null,'black-white',null,true,80),
('40000000-0000-4000-8000-000000000009',null,1,0.75,null,'printed_pages',null,'color',null,true,90),
('40000000-0000-4000-8000-000000000010',null,101,null,10.00,'printed_pages',null,null,null,true,100),
('40000000-0000-4000-8000-000000000011',null,1,0.25,null,'printed_pages',null,'black-white',null,true,110),
('40000000-0000-4000-8000-000000000012',null,1,1.00,null,'printed_pages',null,'color',null,true,120),
('40000000-0000-4000-8000-000000000013',null,1,0.50,null,'printed_pages','30000000-0000-4000-8000-000000000007','black-white',null,true,130),
('40000000-0000-4000-8000-000000000014',null,1,1.50,null,'printed_pages','30000000-0000-4000-8000-000000000007','color',null,true,140),
('40000000-0000-4000-8000-000000000015',null,101,null,10.00,'printed_pages',null,null,null,true,150),
('40000000-0000-4000-8000-000000000016',null,1,0.50,null,'pieces',null,null,1,true,160),
('40000000-0000-4000-8000-000000000017',null,1,0.75,null,'pieces',null,null,2,true,170),
('40000000-0000-4000-8000-000000000018',null,1,0.50,null,'pieces',null,null,1,true,180),
('40000000-0000-4000-8000-000000000019',null,1,0.75,null,'pieces',null,null,2,true,190);

insert ignore into bulk_tier_sizes(tier_id,size_id) values
('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001'),
('40000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002'),
('40000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000002'),
('40000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002'),
('40000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000003'),
('40000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000003'),
('40000000-0000-4000-8000-000000000013','20000000-0000-4000-8000-000000000003'),
('40000000-0000-4000-8000-000000000014','20000000-0000-4000-8000-000000000003'),
('40000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000003'),
('40000000-0000-4000-8000-000000000016','20000000-0000-4000-8000-000000000008'),
('40000000-0000-4000-8000-000000000017','20000000-0000-4000-8000-000000000008'),
('40000000-0000-4000-8000-000000000018','20000000-0000-4000-8000-000000000009'),
('40000000-0000-4000-8000-000000000019','20000000-0000-4000-8000-000000000009');
