-- Which year's emission factors an entry uses.
--   calendar (default)  each month uses its own calendar year's factors (DESNZ 2024 for Nov 2024, DESNZ 2025 for Jan 2025)
--   fy_start / fy_end   one set for the whole reporting year: the calendar year it starts in, or ends in
-- year_start_month: the first month of the company's reporting year (1 = January, 4 = April …).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS year_start_month int NOT NULL DEFAULT 1 CHECK (year_start_month BETWEEN 1 AND 12);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS factor_year text NOT NULL DEFAULT 'calendar' CHECK (factor_year IN ('calendar', 'fy_start', 'fy_end'));
