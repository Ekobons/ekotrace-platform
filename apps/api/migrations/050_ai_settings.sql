-- AI connection chosen by the company (its own Claude, ChatGPT, Gemini, Azure OpenAI or other OpenAI-compatible
-- service, or the platform's approved service), and when AI may run. The key is encrypted (lib/secrets encrypt);
-- only its last 4 characters are shown again. ai_mapping (migration 011) stays the on / off switch.
SELECT set_config('app.platform', 'on', true);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_provider text CHECK (ai_provider IN ('platform', 'anthropic', 'openai', 'gemini', 'azure', 'compatible'));
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_base_url text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_key text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_key_hint text;
-- purchases: 'unidentified' = every kind still without a category after the text match;
-- 'large' = only the large ones (the kinds a person must confirm); 'off' = never
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_purchases text NOT NULL DEFAULT 'large' CHECK (ai_purchases IN ('off', 'large', 'unidentified'));
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_max_groups int NOT NULL DEFAULT 300 CHECK (ai_max_groups BETWEEN 1 AND 5000);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_tested_at timestamptz;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_test_ok boolean;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_updated_by text;
-- a company that had the platform's AI switched on keeps it
UPDATE tenant SET ai_provider = 'platform', ai_purchases = 'unidentified' WHERE ai_mapping AND ai_provider IS NULL;
