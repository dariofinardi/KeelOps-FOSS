-- AlterTable: identità SSO Google (il `sub`), per legare l'account al provider
-- anche se cambia l'email. Nullo per gli utenti solo-locali; UNIQUE ma SQLite
-- ammette più NULL, quindi la nullabilità resta.
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
