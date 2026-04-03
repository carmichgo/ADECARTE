-- Add Line of Credit categories
INSERT INTO categories (name, description, is_suspicious) VALUES
    ('Line of Credit', 'Disbursements and transactions from line of credit facility - informational only, excluded from deposit/withdrawal calculations', false),
    ('Line of Credit Repayment', 'Repayments to line of credit facility', false)
ON CONFLICT (name) DO NOTHING;

-- Fix existing loan disbursement transactions: change direction back to Contribution
-- and set category to Line of Credit
UPDATE transactions SET direction = 'Contribution', category = 'Line of Credit'
WHERE LOWER(direction) IN ('loan disbursement', 'loan repayment')
AND (category = '' OR category IS NULL OR category = 'Line of Credit');

-- If you have specific transactions you know are line of credit disbursements,
-- update them by description:
-- UPDATE transactions SET category = 'Line of Credit'
-- WHERE LOWER(description) LIKE '%loan disburs%';
