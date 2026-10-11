-- How spend of another year meets a spend factor's price year (Setup → Currencies & price index):
-- 'cpi' = exchange rate, then the price index (default); 'none' = exchange rate only.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS price_adjust text NOT NULL DEFAULT 'cpi' CHECK (price_adjust IN ('cpi','none'));
