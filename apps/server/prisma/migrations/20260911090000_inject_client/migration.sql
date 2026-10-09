-- CreateTable
CREATE TABLE "InjectClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "origins" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "replyTo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 20,
    "lastUsedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InjectClient_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InjectClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InjectRequestType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'help',
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InjectRequestType_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "InjectClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InjectRequestType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InjectClient_publicKey_key" ON "InjectClient"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "InjectRequestType_clientId_key_key" ON "InjectRequestType"("clientId", "key");
