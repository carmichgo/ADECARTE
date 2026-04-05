-- Add match_group column for linking related transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS match_group TEXT DEFAULT '';
