-- CBAM Exporter: a package of its own for companies that only need CBAM (installations outside the EU that
-- send embedded emissions to their EU importers). A company can have it alone or with the other products;
-- with EKOTRACE the CBAM pages are also in its Disclose menu.
SELECT set_config('app.platform', 'on', true);
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam']::text[] AND cardinality(products) >= 1);
