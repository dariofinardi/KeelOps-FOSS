-- CreateTable
CREATE TABLE "ProjectReleaseDocument" (
    "projectId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("projectId", "attachmentId"),
    CONSTRAINT "ProjectReleaseDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectReleaseDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectReleaseDocument_attachmentId_idx" ON "ProjectReleaseDocument"("attachmentId");
