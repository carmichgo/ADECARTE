-- Fix "outgoing" direction to "Withdraw"
UPDATE transactions SET direction = 'Withdraw' WHERE LOWER(direction) = 'outgoing';

-- Verify
SELECT direction, COUNT(*) FROM transactions GROUP BY direction ORDER BY COUNT(*) DESC;
