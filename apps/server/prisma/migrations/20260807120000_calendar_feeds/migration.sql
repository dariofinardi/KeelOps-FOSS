-- CreateTable
CREATE TABLE "CalendarFeed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lastReadAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_token_key" ON "CalendarFeed"("token");

-- CreateIndex
CREATE INDEX "CalendarFeed_userId_idx" ON "CalendarFeed"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_userId_scope_targetId_key" ON "CalendarFeed"("userId", "scope", "targetId");
