-- CreateTable
CREATE TABLE "payroll_profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "paystubCount" INTEGER NOT NULL DEFAULT 0,
    "pretaxFlexCents" INTEGER NOT NULL DEFAULT 0,
    "vebaCents" INTEGER NOT NULL DEFAULT 0,
    "excessLifeCents" INTEGER NOT NULL DEFAULT 0,
    "ltdCents" INTEGER NOT NULL DEFAULT 0,
    "mutualAidCents" INTEGER NOT NULL DEFAULT 0,
    "unionDuesCents" INTEGER NOT NULL DEFAULT 0,
    "roth401kCents" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL DEFAULT 'none',
    "rawLearnedData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_profile_userId_key" ON "payroll_profile"("userId");
