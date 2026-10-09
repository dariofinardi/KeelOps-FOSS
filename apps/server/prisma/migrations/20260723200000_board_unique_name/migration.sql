-- Nome board unico per proprietario (evita "Mia" duplicata da race sul primo accesso).
CREATE UNIQUE INDEX "Board_ownerId_name_key" ON "Board"("ownerId", "name");
