-- Run this to add the bank/custodian column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank TEXT DEFAULT '';
-- Set all existing transactions to Pershing BNY
UPDATE transactions SET bank = 'Pershing BNY' WHERE bank = '' OR bank IS NULL;
