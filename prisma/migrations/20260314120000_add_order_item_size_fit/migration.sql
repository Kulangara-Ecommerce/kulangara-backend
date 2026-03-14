-- Add denormalized size and fit to order_items (persists even if variant is deleted)
ALTER TABLE "order_items" ADD COLUMN "size" TEXT;
ALTER TABLE "order_items" ADD COLUMN "fit" TEXT;
