-- India CCTS and SEBI BRSR Core become packages of their own, chosen per company like EKOFIN and CBAM Exporter.
-- Companies already using either keep it.
SELECT set_config('app.platform', 'on', true);
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr']::text[] AND cardinality(products) >= 1);
UPDATE tenant t SET products = products || '{ccts}' WHERE NOT 'ccts' = ANY(products) AND EXISTS (SELECT 1 FROM ccts_entity e WHERE e.tenant_id = t.id);
UPDATE tenant t SET products = products || '{brsr}' WHERE NOT 'brsr' = ANY(products) AND EXISTS (SELECT 1 FROM brsr_report r WHERE r.tenant_id = t.id);
