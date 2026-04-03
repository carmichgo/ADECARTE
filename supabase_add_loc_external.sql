-- Add LOC External Transfer category
INSERT INTO categories (name, description, is_suspicious) VALUES
    ('LOC External Transfer', 'Money from line of credit sent to external (non-owned) accounts — counts as a real withdrawal', false)
ON CONFLICT (name) DO NOTHING;
