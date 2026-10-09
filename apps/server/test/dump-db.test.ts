import { existsSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("dump-db");

const { prisma } = await import("../src/db");
const { dumpDatabase, estensioneDump } = await import("../src/modules/admin/dump-db");
const { snapshotName } = await import("../src/modules/admin/db-snapshot");

beforeAll(async () => {
  await prisma.user.create({
    data: { email: "chi@dump.local", name: "Chi Dump", role: "MEMBER" },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Il backup indipendente dal motore, provato su SQLite — che è la produzione di
 * oggi e resta il caso che non deve cambiare. Su MariaDB il dump lo fa
 * `mariadb-dump`, che qui non c'è: quella strada si prova sull'ambiente vero
 * (scripts/mariadb/prova-ripristino.ts, che ripristina e riconta).
 */
describe("portare via il database", () => {
  it("su SQLite produce una copia .db apribile, con i dati dentro", async () => {
    const dove = mkdtempSync(path.join(tmpdir(), "prova-dump-"));
    try {
      const esito = await dumpDatabase(dove, "prova");
      expect(esito.formato).toBe("db");
      expect(esito.file.endsWith("prova.db")).toBe(true);
      expect(existsSync(esito.file)).toBe(true);
      expect(statSync(esito.file).size).toBeGreaterThan(0);

      // La copia è un database vero, e contiene la riga scritta prima.
      const { default: Database } = await import("better-sqlite3");
      const copia = new Database(esito.file, { readonly: true });
      const riga = copia.prepare("SELECT email FROM User WHERE email = ?").get("chi@dump.local");
      copia.close();
      expect(riga).toEqual({ email: "chi@dump.local" });
    } finally {
      rmSync(dove, { recursive: true, force: true });
    }
  });

  it("l'estensione dice cosa c'è dentro, e il nome dell'istantanea la segue", () => {
    expect(estensioneDump()).toBe("db");
    const data = new Date("2026-08-19T00:00:00Z");
    expect(snapshotName(data, "0.9.162", "66a2c9d")).toBe(
      "keelops-20260819-0000-0.9.162-66a2c9d.db.gz",
    );
    // Su MariaDB lo stesso nome finisce in .sql.gz: un `.db` con dentro SQL
    // sarebbe un archivio che nessuno sa più come rimettere a posto.
    expect(snapshotName(data, "0.9.162", "66a2c9d", "sql")).toBe(
      "keelops-20260819-0000-0.9.162-66a2c9d.sql.gz",
    );
  });
});
