-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "transactionUuid" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "input" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "mockScenario" TEXT,
    "invoiceNo" TEXT,
    "reservationCode" TEXT,
    "viettelTxnId" TEXT,
    "codeOfTax" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "method" TEXT,
    "url" TEXT,
    "requestBody" TEXT,
    "status" INTEGER,
    "responseBody" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenCache" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockToken" (
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "MockInvoice" (
    "transactionUuid" TEXT NOT NULL,
    "supplierTaxCode" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "invoiceSeries" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "reservationCode" TEXT NOT NULL,
    "transactionID" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "numberReadyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockInvoice_pkey" PRIMARY KEY ("transactionUuid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_idempotencyKey_key" ON "Invoice"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_transactionUuid_key" ON "Invoice"("transactionUuid");

-- CreateIndex
CREATE INDEX "ApiLog_invoiceId_idx" ON "ApiLog"("invoiceId");

-- CreateIndex
CREATE INDEX "ApiLog_createdAt_idx" ON "ApiLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MockInvoice_invoiceNo_key" ON "MockInvoice"("invoiceNo");

-- AddForeignKey
ALTER TABLE "ApiLog" ADD CONSTRAINT "ApiLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

