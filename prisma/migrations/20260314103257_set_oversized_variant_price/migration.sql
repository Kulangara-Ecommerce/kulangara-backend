-- Set price to 599 for all OVERSIZED product variants
-- Normal fit continues to use product base price (499)
UPDATE product_variants
SET price = 599
WHERE fit = 'OVERSIZED';
