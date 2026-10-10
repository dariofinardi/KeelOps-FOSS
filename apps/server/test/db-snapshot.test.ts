// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("snapshot");

const { prisma, initDb } = await import("../src/db");
const { localStore, setAttachmentStore } = await import("../src/modules/attachments/store");
const { runDatabaseSnapshot, pruneSnapshots, snapshotName, snapshotDate, SNAPSHOT_PREFIX } =
  await import("../src/modules/admin/db-snapshot");

const store = localStore(`${tempDir}/magazzino`);

beforeAll(async () => {
  await initDb();
  // L'istantanea va **nel magazzino degli allegati**: in produzione il bucket,
  // qui una cartella. È lo stesso codice.
  setAttachmentStore(store);
});

afterAll(async () => {
  setAttachmentStore(null);
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("nome dell'istantanea", () => {
  it("mette la data davanti: l'ordine alfabetico è l'ordine cronologico", () => {
    const a = snapshotName(new Date("2026-08-19T00:00:00Z"), "0.9.162", "66a2c9d");
    const b = snapshotName(new Date("2026-09-02T00:00:00Z"), "0.9.170", "aaaaaaa");
    expect(a).toBe("keelops-20260819-0000-0.9.162-66a2c9d.db.gz");
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("senza commit resta la versione: metà risposta è meglio di nessuna", () => {
    expect(snapshotName(new Date("2026-08-19T00:00:00Z"), "0.9.162", null)).toBe(
      "keelops-20260819-0000-0.9.162.db.gz",
    );
  });

  it("la data si rilegge dal nome, e un file estraneo non si data", () => {
    // La retention cancella: deve sapere con certezza cosa sta guardando.
    expect(snapshotDate("keelops-20260819-0230-0.9.162-abc1234.db.gz")).toEqual(
      new Date("2026-08-19T02:30:00.000Z"),
    );
    expect(snapshotDate("qualcosa-daltro.zip")).toBeNull();
    expect(snapshotDate("keelops-backup.db.gz")).toBeNull();
  });
});

describe("istantanea notturna del database", () => {
  it("scrive nel magazzino un database vero, compresso e riapribile", async () => {
    const key = await runDatabaseSnapshot(new Date("2026-08-19T00:00:00Z"));
    expect(key.startsWith(`${SNAPSHOT_PREFIX}/`)).toBe(true);

    const gz = await store.read(key);
    const db = gunzipSync(gz);
    // L'intestazione di un file SQLite: se la copia fosse corrotta o vuota, qui
    // si vedrebbe — ed è il difetto che si scopre solo il giorno del ripristino.
    expect(db.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(gz.length).toBeLessThan(db.length);
  });

  it("la retention guarda la data nel nome, non quella del file", async () => {
    // Sul bucket la data di modifica cambia per motivi che non c'entrano col
    // contenuto: cancellare per quella vorrebbe dire cancellare a caso.
    await store.write(
      `${SNAPSHOT_PREFIX}/keelops-20260101-0000-0.9.100-old1234.db.gz`,
      Buffer.from("x"),
    );
    await store.write(`${SNAPSHOT_PREFIX}/non-nostro.txt`, Buffer.from("x"));

    const removed = await pruneSnapshots(new Date("2026-08-19T00:00:00Z"));
    expect(removed).toBe(1);
    const rimasti = (await store.list(SNAPSHOT_PREFIX)).map((f) => f.key);
    // Quella di oggi resta, e ciò che non è nostro non si tocca.
    expect(rimasti.some((k) => k.includes("20260819"))).toBe(true);
    expect(rimasti.some((k) => k.endsWith("non-nostro.txt"))).toBe(true);
    expect(rimasti.some((k) => k.includes("20260101"))).toBe(false);
  });
});
