-- Lo storico SQLite era rimasto indietro rispetto allo schema (14/09/2026):
-- il default di `User.locale` era ancora 'it' invece di 'auto', e le colonne
-- aggiunte con ALTER TABLE su `RecurrenceTemplate` (relatedDealId,
-- initialStatusId) erano senza vincolo di chiave esterna. MariaDB, in
-- produzione, era già giusto. Qui SQLite ricostruisce le due tabelle come
-- fa sempre — copia, drop, rinomina — senza perdere una riga.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecurrenceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rrule" TEXT NOT NULL,
    "dtstart" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "relatedDealId" TEXT,
    "initialStatusId" TEXT,
    "activityTypeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "supervisorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurrenceTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_relatedDealId_fkey" FOREIGN KEY ("relatedDealId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_initialStatusId_fkey" FOREIGN KEY ("initialStatusId") REFERENCES "TaskStatus" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurrenceTemplate_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RecurrenceTemplate" ("activityTypeId", "assigneeId", "createdAt", "creatorId", "description", "dtstart", "id", "initialStatusId", "isActive", "projectId", "relatedDealId", "rrule", "supervisorId", "title", "updatedAt") SELECT "activityTypeId", "assigneeId", "createdAt", "creatorId", "description", "dtstart", "id", "initialStatusId", "isActive", "projectId", "relatedDealId", "rrule", "supervisorId", "title", "updatedAt" FROM "RecurrenceTemplate";
DROP TABLE "RecurrenceTemplate";
ALTER TABLE "new_RecurrenceTemplate" RENAME TO "RecurrenceTemplate";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "authProvider" TEXT NOT NULL DEFAULT 'LOCAL',
    "googleId" TEXT,
    "companyId" TEXT,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0,
    "passwordLockedUntil" DATETIME,
    "lockoutAlertedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "adminUntil" DATETIME,
    "lastSeenAt" DATETIME,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "nickName" TEXT,
    "accentColor" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "locale" TEXT NOT NULL DEFAULT 'auto',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "emailDigest" BOOLEAN NOT NULL DEFAULT false,
    "emailWeekend" BOOLEAN NOT NULL DEFAULT false,
    "canViewAllTimesheets" BOOLEAN NOT NULL DEFAULT false,
    "boardsInitializedAt" DATETIME,
    "projectOrder" TEXT,
    "columnOrder" TEXT,
    "weeklyHours" INTEGER NOT NULL DEFAULT 40,
    "calendarAliases" TEXT,
    "billingAssigneeId" TEXT,
    "calendarToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_billingAssigneeId_fkey" FOREIGN KEY ("billingAssigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("accentColor", "adminUntil", "authProvider", "avatarUrl", "billingAssigneeId", "boardsInitializedAt", "calendarAliases", "calendarToken", "canViewAllTimesheets", "columnOrder", "companyId", "createdAt", "currency", "email", "emailDigest", "emailWeekend", "failedPasswordAttempts", "googleId", "id", "isActive", "isSystem", "lastLoginAt", "lastSeenAt", "locale", "lockoutAlertedAt", "mustChangePassword", "name", "nickName", "passwordHash", "passwordLockedUntil", "projectOrder", "role", "theme", "updatedAt", "weeklyHours") SELECT "accentColor", "adminUntil", "authProvider", "avatarUrl", "billingAssigneeId", "boardsInitializedAt", "calendarAliases", "calendarToken", "canViewAllTimesheets", "columnOrder", "companyId", "createdAt", "currency", "email", "emailDigest", "emailWeekend", "failedPasswordAttempts", "googleId", "id", "isActive", "isSystem", "lastLoginAt", "lastSeenAt", "locale", "lockoutAlertedAt", "mustChangePassword", "name", "nickName", "passwordHash", "passwordLockedUntil", "projectOrder", "role", "theme", "updatedAt", "weeklyHours" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
