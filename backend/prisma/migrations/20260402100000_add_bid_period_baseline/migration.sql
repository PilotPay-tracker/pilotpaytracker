-- CreateTable
CREATE TABLE "bid_period_baseline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStartISO" TEXT NOT NULL,
    "periodEndISO" TEXT NOT NULL,
    "awardedCreditMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual_entry',
    "sourceNote" TEXT,
    "uploadId" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_period_baseline_userId_periodKey_key" ON "bid_period_baseline"("userId", "periodKey");

-- CreateIndex
CREATE INDEX "bid_period_baseline_userId_idx" ON "bid_period_baseline"("userId");

-- CreateIndex
CREATE INDEX "bid_period_baseline_periodKey_idx" ON "bid_period_baseline"("periodKey");
