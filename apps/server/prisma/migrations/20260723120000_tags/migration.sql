-- Etichette libere sui task (Tag + ponte TaskTag).
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    PRIMARY KEY ("taskId", "tagId"),
    CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");
