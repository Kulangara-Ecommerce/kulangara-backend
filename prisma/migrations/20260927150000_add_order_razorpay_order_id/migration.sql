-- AlterTable
ALTER TABLE "orders" ADD COLUMN "razorpayOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpayOrderId_key" ON "orders"("razorpayOrderId");
