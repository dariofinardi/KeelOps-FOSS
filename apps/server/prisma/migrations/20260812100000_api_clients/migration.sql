-- Account di servizio per le integrazioni (12/08/2026): si autenticano da soli
-- e agiscono per conto di una persona vera. Del segreto resta solo l'impronta.
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApiClient_clientId_key" ON "ApiClient"("clientId");
