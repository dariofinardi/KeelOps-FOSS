-- Progetti su cui un utente del portale può aprire richieste.
--
-- Tabella a parte e non `ProjectMember`: essere membro di un progetto dà
-- visibilità sui suoi task, e un cliente non deve vedere il lavoro interno. Qui
-- si dichiara soltanto "questo cliente può aprire richieste su questo progetto",
-- che è un permesso di scrittura mirato, non un accesso in lettura.
CREATE TABLE "PortalProjectAccess" (
  "userId"    TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "projectId"),
  CONSTRAINT "PortalProjectAccess_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PortalProjectAccess_projectId_fkey" FOREIGN KEY ("projectId")
    REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PortalProjectAccess_projectId_idx" ON "PortalProjectAccess" ("projectId");
