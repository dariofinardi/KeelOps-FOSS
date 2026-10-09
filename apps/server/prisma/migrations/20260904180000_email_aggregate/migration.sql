-- Le email raccolte in un riepilogo invece che una per una: 14 avvisi in otto
-- minuti sono 14 email, e a quel punto nessuno le legge più. Spento per tutti
-- finché non lo si chiede: chi non tocca niente continua a riceverle subito.
ALTER TABLE "User" ADD COLUMN "emailDigest" BOOLEAN NOT NULL DEFAULT false;

-- L'email dovuta che aspetta il prossimo riepilogo.
ALTER TABLE "Notification" ADD COLUMN "emailPending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Notification_userId_emailPending_idx" ON "Notification"("userId", "emailPending");
