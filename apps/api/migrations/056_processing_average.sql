-- 3.10 Processing of sold products, average-data method: the typical energy per tonne of a downstream
-- process (electricity and heat), from published benchmarks in data/processing/process-energy.csv
-- (items written by seedProcessing on every start). Electricity × the facility's grid factor,
-- heat × the DESNZ natural gas factor. The old Ekotrace table processing_of_sold_products_ef is not used:
-- its values were not traceable to a source and its units were inconsistent.
SELECT set_config('app.platform', 'on', true);

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, 'p10_average', 'Typical processing energy (average data)', '{t,kg}', 't', 2
FROM category c WHERE c.code = 'processing_sold'
ON CONFLICT (category_id, code) DO NOTHING;
UPDATE subcategory SET sort = 3 WHERE code = 'p10_reported';
