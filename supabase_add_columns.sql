-- Run this if you already have the transactions table and need to add the new trading columns
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS settle_date TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS unit_price DOUBLE PRECISION DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quantity DOUBLE PRECISION DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS symbol TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS security TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT '';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);
CREATE INDEX IF NOT EXISTS idx_transactions_strategy ON transactions(strategy);
