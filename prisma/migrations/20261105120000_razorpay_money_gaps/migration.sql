-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "paymentIssue" TEXT,
ADD COLUMN     "paymentIssueAt" TIMESTAMP(3),
ADD COLUMN     "paymentIssuePaymentId" TEXT,
ADD COLUMN     "razorpayRefundId" TEXT;
