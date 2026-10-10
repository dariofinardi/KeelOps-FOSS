// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("storage");
const uploads = path.join(tempDir, "uploads");
process.env.UPLOADS_DIR = uploads;
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { attachmentStore } = await import("../src/modules/attachments/store");
const { computeStorageUsage, cachedStorageUsage, refreshStorageUsage, isStale, backupStatus } =
  await import("../src/modules/admin/storage-usage");

/**
 * Il conteggio dello spazio: quel che conta è **cosa somma** e **quando lo ha
 * fatto**. Un numero senza la sua data non si sa se valga ancora.
 */
beforeAll(async () => {
  const store = attachmentStore();
  await store.write("task-1/relazione.pdf", Buffer.alloc(3000));
  await store.write("task-1/schermata.png", Buffer.alloc(1000));
  // L'istantanea del database vive nello stesso magazzino, ma non è un allegato.
  await store.write("backup/keelops-20260819-0000-0.9.171-abc1234.db.gz", Buffer.alloc(5000));
  await mkdir(process.env.BACKUPS_DIR!, { recursive: true });
  await writeFile(
    path.join(process.env.BACKUPS_DIR!, "kancrm-backup-2026-08-19.zip"),
    Buffer.alloc(9000),
  );
});

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("lo spazio occupato", () => {
  it("gli allegati e le istantanee si contano a parte", async () => {
    // Se il magazzino cresce, la domanda è se a crescere siano i documenti
    // degli utenti o le copie notturne: un totale unico non risponde.
    const usage = await computeStorageUsage();
    expect(usage.files).toBe(2);
    expect(usage.bytes).toBe(4000);
    expect(usage.backupFiles).toBe(1);
    expect(usage.backupBytes).toBe(5000);
    expect(usage.error).toBeNull();
  });

  it("il conteggio si tiene da parte e sopravvive al riavvio", async () => {
    // Sta in banca dati e non in memoria: un riavvio non deve far ripartire
    // la pagina da "non lo so".
    expect(await cachedStorageUsage()).toBeNull();
    const scritto = await refreshStorageUsage();
    const letto = await cachedStorageUsage();
    expect(letto?.bytes).toBe(scritto.bytes);
    expect(letto?.countedAt).toBe(scritto.countedAt);
  });

  it("un conteggio di ieri l'altro si considera vecchio, e uno mai fatto anche", () => {
    const ieri = new Date("2026-08-18T03:15:00.000Z");
    const oggi = new Date("2026-08-19T10:00:00.000Z");
    expect(isStale(null)).toBe(true);
    expect(isStale({ countedAt: ieri.toISOString() } as never, oggi)).toBe(true);
    expect(isStale({ countedAt: oggi.toISOString() } as never, oggi)).toBe(false);
  });
});

describe("lo stato dei backup", () => {
  it("dice qual è l'ultima copia, di quando è e quanto pesa", async () => {
    const stato = await backupStatus();
    expect(stato.snapshot?.bytes).toBe(5000);
    // La data si legge dal NOME: sul bucket la data di modifica di un oggetto
    // può cambiare per motivi che non riguardano il suo contenuto.
    expect(stato.snapshot?.at).toBe("2026-08-19T00:00:00.000Z");
    expect(stato.snapshotCount).toBe(1);
    expect(stato.zip?.bytes).toBe(9000);
    expect(stato.zipCount).toBe(1);
  });
});
