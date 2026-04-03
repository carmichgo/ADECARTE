-- Add LOC Funded Deposit category
INSERT INTO categories (name, description, is_suspicious) VALUES
    ('LOC Funded Deposit', 'Deposit into account funded by Line of Credit — counts as real deposit, tracks LOC as source', false)
ON CONFLICT (name) DO NOTHING;
