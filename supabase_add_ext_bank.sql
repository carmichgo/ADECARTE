-- Add receiving/originating bank column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ext_bank TEXT DEFAULT '';
