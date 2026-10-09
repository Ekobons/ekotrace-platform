-- Waste.
--   Scope 1  waste treated at the company's own sites: landfills (first order decay or
--            measured gas), incineration / waste-to-energy, composting and anaerobic
--            digestion, wastewater. IPCC 2006 Vol. 5 with the 2019 Refinement.
--   Scope 3  category 5: waste the company sends to other companies (DESNZ waste
--            disposal factors per tonne, by material and treatment route).

-- ------------------------------------------------------------------- bases --
-- scope3: a Scope 3 category other than 3.3; the category's ghg_category says which.
ALTER TABLE factor DROP CONSTRAINT IF EXISTS factor_basis_check;
ALTER TABLE factor ADD CONSTRAINT factor_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2','scope2_market','td_loss','scope3'));
ALTER TABLE activity_result DROP CONSTRAINT IF EXISTS activity_result_basis_check;
ALTER TABLE activity_result ADD CONSTRAINT activity_result_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2','scope2_market','td_loss','scope3'));
ALTER TABLE activity ADD COLUMN IF NOT EXISTS co2e_scope3 numeric(30,9) NOT NULL DEFAULT 0;

-- --------------------------------------------------------------- catalogue --
ALTER TABLE category ADD COLUMN IF NOT EXISTS ghg_category smallint CHECK (ghg_category BETWEEN 1 AND 15);
ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal'));

INSERT INTO category (scope, code, name, calc_method, description, sort) VALUES
  (1, 'waste_treatment', 'Waste treatment (own sites)', 'waste',
   'Landfills, incineration / waste-to-energy, composting, anaerobic digestion and wastewater treatment that the company operates. IPCC 2006 Vol. 5 with the 2019 Refinement.', 40)
ON CONFLICT (code) DO NOTHING;
INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'waste_generated', 'Waste sent to others (Scope 3.5)', 'waste_disposal',
   'Waste the company sends to other companies for landfill, recycling, composting, digestion or combustion: tonnes × DESNZ waste disposal factor by material and route.', 50, 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('landfill',       'Landfill', '{t}', 't', 1),
  ('incineration',   'Incineration / waste-to-energy', '{t}', 't', 2),
  ('biological',     'Composting & anaerobic digestion', '{t}', 't', 3),
  ('wastewater',     'Wastewater treatment', '{kg}', 'kg', 4)
) AS v(code, name, units, def, sort)
WHERE c.code = 'waste_treatment'
ON CONFLICT (category_id, code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, v.code, v.name, v.def, v.note, v.sort
FROM subcategory s JOIN (VALUES
  ('landfill', 'waste:landfill', 'Landfill methane', 't', 'Quantity: methane generated in the period (t CH4).', 1),
  ('incineration', 'waste:incineration', 'Incineration / waste-to-energy', 't', 'Quantity: tonnes of waste incinerated (wet weight).', 1),
  ('biological', 'waste:composting', 'Composting', 't', 'Quantity: tonnes of waste treated.', 1),
  ('biological', 'waste:ad', 'Anaerobic digestion', 't', 'Quantity: tonnes of waste treated.', 2),
  ('wastewater', 'waste:wastewater', 'Wastewater treatment', 'kg', 'Quantity: kg BOD or COD treated.', 1)
) AS v(sub, code, name, def, note, sort) ON v.sub = s.code
JOIN category c ON c.id = s.category_id AND c.code = 'waste_treatment'
ON CONFLICT (code) DO NOTHING;

-- Scope 3.5 subcategories follow the DESNZ "Waste disposal" groups; items are loaded by the DESNZ importer.
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, '{t,kg}'::text[], 't', v.sort
FROM category c, (VALUES
  ('waste3_refuse', 'Refuse (mixed waste)', 1), ('waste3_construction', 'Construction', 2), ('waste3_paper', 'Paper', 3),
  ('waste3_plastic', 'Plastic', 4), ('waste3_metal', 'Metal', 5), ('waste3_electrical', 'Electrical items', 6), ('waste3_other', 'Other', 7)
) AS v(code, name, sort)
WHERE c.code = 'waste_generated'
ON CONFLICT (category_id, code) DO NOTHING;

-- ------------------------------------------------------------ waste sites --
-- A landfill (or other treatment site) of the company, with its IPCC parameters
-- (climate, site type / MCF, oxidation, composition, values replacing defaults).
CREATE TABLE IF NOT EXISTS waste_site (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL REFERENCES org_node(id),
  kind         text NOT NULL DEFAULT 'landfill' CHECK (kind IN ('landfill')),
  name         text NOT NULL,
  opened_year  int CHECK (opened_year BETWEEN 1900 AND 2100),
  closed_year  int CHECK (closed_year BETWEEN 1900 AND 2100),
  params       jsonb NOT NULL DEFAULT '{}',
  note         text,
  active       boolean NOT NULL DEFAULT true,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waste_site_facility ON waste_site(facility_id);

-- Tonnes placed per year and waste type ('msw' = mixed municipal waste, split by the site's composition).
CREATE TABLE IF NOT EXISTS waste_deposit (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES waste_site(id) ON DELETE CASCADE,
  year        int NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  waste_type  text NOT NULL,
  tonnes      numeric(20,3) NOT NULL CHECK (tonnes >= 0),
  source      text,
  estimated   boolean NOT NULL DEFAULT false,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, year, waste_type)
);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS waste_site_id uuid REFERENCES waste_site(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['waste_site','waste_deposit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
