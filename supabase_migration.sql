-- Run this in Supabase SQL Editor to create the required tables

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    upload_batch TEXT,
    date TEXT,
    settle_date TEXT DEFAULT '',
    description TEXT,
    amount DOUBLE PRECISION,
    unit_price DOUBLE PRECISION DEFAULT 0,
    quantity DOUBLE PRECISION DEFAULT 0,
    currency TEXT DEFAULT '',
    account TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    counterparty TEXT DEFAULT '',
    symbol TEXT DEFAULT '',
    security TEXT DEFAULT '',
    strategy TEXT DEFAULT '',
    direction TEXT DEFAULT '',
    raw_data JSONB,
    category TEXT DEFAULT '',
    subcategory TEXT DEFAULT '',
    flag TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    categorized_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE,
    description TEXT DEFAULT '',
    is_suspicious BOOLEAN DEFAULT FALSE
);

-- Seed default categories
INSERT INTO categories (name, description, is_suspicious) VALUES
    ('Salaries & Payroll', 'Regular employee compensation', false),
    ('Vendor Payments', 'Payments to suppliers and vendors', false),
    ('Utilities', 'Electricity, water, internet, phone', false),
    ('Rent & Lease', 'Office or property rental payments', false),
    ('Professional Services', 'Legal, accounting, consulting fees', false),
    ('Travel & Entertainment', 'Business travel and entertainment', false),
    ('Office Supplies', 'Stationery, equipment, supplies', false),
    ('Insurance', 'Business insurance premiums', false),
    ('Taxes & Government', 'Tax payments, government fees', false),
    ('Loan & Interest', 'Loan repayments, interest charges', false),
    ('Transfers Between Accounts', 'Internal transfers', false),
    ('Stocks', 'Stock and securities purchases, sales, and trades', false),
    ('Revenue / Income', 'Incoming revenue or payments received', false),
    ('Refunds & Returns', 'Returned payments or refunds', false),
    ('SUSPICIOUS - Unauthorized Transfer', 'Transfers not matching authorized patterns', true),
    ('SUSPICIOUS - Unknown Recipient', 'Payments to unrecognized parties', true),
    ('SUSPICIOUS - Unusual Amount', 'Amounts outside normal ranges', true),
    ('SUSPICIOUS - Duplicate Payment', 'Possible duplicate or repeated payments', true),
    ('SUSPICIOUS - Off-Hours Transaction', 'Transactions at unusual times', true),
    ('SUSPICIOUS - Round Number', 'Suspiciously round amounts', true),
    ('Other', 'Uncategorized transactions', false)
ON CONFLICT (name) DO NOTHING;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_flag ON transactions(flag);
CREATE INDEX IF NOT EXISTS idx_transactions_categorized_by ON transactions(categorized_by);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_upload_batch ON transactions(upload_batch);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);
CREATE INDEX IF NOT EXISTS idx_transactions_strategy ON transactions(strategy);
