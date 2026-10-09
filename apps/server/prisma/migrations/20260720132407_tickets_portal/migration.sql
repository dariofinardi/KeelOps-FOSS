-- AlterTable
ALTER TABLE "Task" ADD COLUMN "ticketPriority" TEXT;
ALTER TABLE "Task" ADD COLUMN "ticketRef" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "authProvider" TEXT NOT NULL DEFAULT 'LOCAL',
    "companyId" TEXT,
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("authProvider", "avatarUrl", "createdAt", "email", "id", "isActive", "name", "passwordHash", "role", "updatedAt") SELECT "authProvider", "avatarUrl", "createdAt", "email", "id", "isActive", "name", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
