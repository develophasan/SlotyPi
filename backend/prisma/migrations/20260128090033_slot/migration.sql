-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "piUid" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "piPaymentId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "amountPi" REAL NOT NULL,
    "txid" TEXT,
    "statusDeveloperApproved" BOOLEAN NOT NULL DEFAULT false,
    "statusTransactionVerified" BOOLEAN NOT NULL DEFAULT false,
    "statusDeveloperCompleted" BOOLEAN NOT NULL DEFAULT false,
    "statusCancelled" BOOLEAN NOT NULL DEFAULT false,
    "statusUserCancelled" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creditedLedgerEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_creditedLedgerEntryId_fkey" FOREIGN KEY ("creditedLedgerEntryId") REFERENCES "LedgerEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCredits" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_piUid_key" ON "User"("piUid");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_piPaymentId_key" ON "Payment"("piPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_creditedLedgerEntryId_key" ON "Payment"("creditedLedgerEntryId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_refType_refId_type_key" ON "LedgerEntry"("refType", "refId", "type");
