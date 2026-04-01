-- Run this to add the Stocks category
INSERT INTO categories (name, description, is_suspicious) VALUES
    ('Stocks', 'Stock and securities purchases, sales, and trades', false)
ON CONFLICT (name) DO NOTHING;
