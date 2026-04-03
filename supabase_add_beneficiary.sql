-- Add beneficiary column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS beneficiary TEXT DEFAULT '';
