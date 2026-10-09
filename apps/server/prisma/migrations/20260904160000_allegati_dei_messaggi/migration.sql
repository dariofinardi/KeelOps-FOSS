-- Il file allegato a un messaggio. L'allegato resta del task (è lì che si cerca
-- mesi dopo); questa tabella dice con quale messaggio è arrivato. Cancellando il
-- messaggio si scioglie il legame, non si porta via il file dal task.
CREATE TABLE "CommentAttachment" (
    "commentId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    CONSTRAINT "CommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommentAttachment_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("commentId", "attachmentId")
);
