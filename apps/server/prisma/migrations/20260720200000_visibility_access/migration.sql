-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VisibilitySetting" (
    "scope" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'FULL',

    PRIMARY KEY ("scope", "groupId"),
    CONSTRAINT "VisibilitySetting_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VisibilitySetting" ("groupId", "scope") SELECT "groupId", "scope" FROM "VisibilitySetting";
DROP TABLE "VisibilitySetting";
ALTER TABLE "new_VisibilitySetting" RENAME TO "VisibilitySetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

