-- Purchases: decide once per kind of purchase, review only what matters.
--
--   Groups: same description + supplier + account. A group's spend category comes from (first
--   answer wins) a remembered choice, a code in the file, a clear description, the supplier's
--   default, the account's default, a weaker description match, else an average factor.
--   Capital goods: the account says so, or the product is on the capital-goods list.
--   Review: groups sorted by emissions; the largest (up to the company's coverage, 95 %) must be
--   confirmed by a person, the small tail is accepted with its best answer.

ALTER TABLE purchase_group ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES supplier(id) ON DELETE SET NULL;
ALTER TABLE purchase_group ADD COLUMN IF NOT EXISTS capital_why text;
ALTER TABLE purchase_group ADD COLUMN IF NOT EXISTS material boolean NOT NULL DEFAULT false;   -- among the groups making up the coverage share
ALTER TABLE purchase_group ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;  -- a person (or a remembered choice) settled it
ALTER TABLE purchase_group ADD COLUMN IF NOT EXISTS co2e numeric(24,6);
ALTER TABLE purchase_group DROP CONSTRAINT IF EXISTS purchase_group_map_method_check;
ALTER TABLE purchase_group ADD CONSTRAINT purchase_group_map_method_check
  CHECK (map_method IN ('rule','text','ai','manual','code','supplier','gl','category','fallback'));
CREATE INDEX IF NOT EXISTS purchase_group_co2e ON purchase_group(batch_id, co2e DESC NULLS LAST);

-- Lines of a large group not confirmed yet wait under "check".
ALTER TABLE purchase_line DROP CONSTRAINT IF EXISTS purchase_line_status_check;
ALTER TABLE purchase_line ADD CONSTRAINT purchase_line_status_check
  CHECK (status IN ('new','problem','unmapped','flagged','check','excluded','ready','published'));

-- An account's type: purchase (default), capital (Scope 3.2), or not a purchase (VAT, salaries,
-- depreciation, intercompany…: left out). Supplier rules use the supplier id as pattern.
ALTER TABLE purchase_rule ADD COLUMN IF NOT EXISTS account_type text CHECK (account_type IN ('purchase','capital','not_purchase'));
ALTER TABLE purchase_rule ADD COLUMN IF NOT EXISTS label text;          -- the account or supplier as written

-- How much of a batch's emissions a person must confirm (the rest is accepted automatically).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS review_coverage numeric(4,3) NOT NULL DEFAULT 0.95 CHECK (review_coverage BETWEEN 0.5 AND 1);

-- Average spend factors, the last resort for small unclear purchases (shown as estimates).
SELECT set_config('app.platform', 'on', true);
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, v.code, v.name, 'USD', v.note, 998
  FROM subcategory s JOIN category c ON c.id = s.category_id,
       (VALUES ('purchase:average-services', 'Services (average factor)', 'Median EPA factor of service industries (NAICS 42–81): used for small purchases nothing else identifies.'),
               ('purchase:average-goods', 'Goods (average factor)', 'Median EPA factor of goods industries (NAICS 11–33, fuels and utilities left out): used for small purchases nothing else identifies.')) AS v(code, name, note)
 WHERE c.code = 'purchased_goods' AND s.code = 'other'
ON CONFLICT (code) DO NOTHING;
