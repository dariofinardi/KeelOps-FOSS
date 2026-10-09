-- Il messaggio è stato mandato al cliente (@user): senza questo, dopo, nessuno
-- saprebbe più se al cliente è stato scritto — il comando sparisce dal testo.
ALTER TABLE "Comment" ADD COLUMN "sentToClient" BOOLEAN NOT NULL DEFAULT false;
