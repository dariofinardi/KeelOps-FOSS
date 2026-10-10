// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("backup-zip");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
// La memoria del modello delle assenze e il registro del calendario: nella
// cartella di prova, così il test decide se esistono o no.
process.env.ABSENCE_MEMORY_FILE = path.join(tempDir, "assenze-modello.jsonl");
process.env.ABSENCE_REGISTRY_FILE = path.join(tempDir, "assenze-calendario.json");

const { attachmentStore, setAttachmentStore } = await import("../src/modules/attachments/store");
const { writeBackupZip } = await import("../src/modules/admin/backup");

/**
 * **Gli allegati entrano nello zip solo se stanno su questo disco.**
 *
 * Con un bucket i file sono già fuori dalla macchina: rimetterli nell'archivio
 * ogni notte vuol dire scaricarli tutti per riscriverli sul disco da cui il
 * backup serve a scappare — 4,6 GB a notte dopo l'import ClickUp, oltre cento
 * con la retention di trenta giorni (20/08/2026).
 */
const locale = attachmentStore();
/** Lo stesso magazzino che però si dichiara remoto: niente rete nei test. */
const remoto = { ...locale, kind: "gcs" as const, describe: () => "gs://finto" };
const cartella = mkdtempSync(path.join(tmpdir(), "zip-prova-"));

beforeAll(async () => {
  await locale.write("task-1/relazione.pdf", Buffer.from("finto pdf"));
});

afterAll(() => {
  rmSync(cartella, { recursive: true, force: true });
  rmSync(tempDir, { recursive: true, force: true });
});

/** I nomi dentro lo zip, letti dal grezzo: basta a dire cosa c'è. */
function dentro(file: string): string {
  return readFileSync(file).toString("latin1");
}

describe("lo zip di backup", () => {
  it("col magazzino su disco porta database e allegati", async () => {
    setAttachmentStore(locale);
    const zip = path.join(cartella, "locale.zip");
    await writeBackupZip(zip);
    const contenuto = dentro(zip);
    expect(contenuto).toContain("app.db");
    expect(contenuto).toContain("uploads/task-1/relazione.pdf");
  });

  it("col magazzino su bucket porta il solo database", async () => {
    // Non si tocca la rete: basta che il magazzino si **dichiari** remoto
    // perché lo zip smetta di raccoglierne il contenuto. Se un giorno la
    // decisione smettesse di passare da `kind`, questo test lo direbbe.
    setAttachmentStore(remoto);
    const zip = path.join(cartella, "bucket.zip");
    await writeBackupZip(zip);
    const contenuto = dentro(zip);
    expect(contenuto).toContain("app.db");
    expect(contenuto).not.toContain("uploads/");
    setAttachmentStore(locale);
  });

  it("e lo dichiara dentro l'archivio, invece di lasciarlo dedurre", async () => {
    // Chi ripristina fra un anno non deve capire da un `uploads/` assente se i
    // file mancano o non ci sono mai stati.
    setAttachmentStore(remoto);
    const zip = path.join(cartella, "spiegato.zip");
    await writeBackupZip(zip);
    expect(dentro(zip)).toContain("LEGGIMI.txt");
    setAttachmentStore(locale);
  });
});

describe("la memoria delle assenze nel backup", () => {
  it("i due file entrano nello zip quando esistono, e mancano senza rumore quando no", async () => {
    setAttachmentStore(locale);

    // Senza i file: lo zip si scrive lo stesso, senza voci fantasma.
    const senza = path.join(cartella, "senza-assenze.zip");
    await writeBackupZip(senza);
    expect(dentro(senza)).not.toContain("assenze-modello.jsonl");

    // Coi file: dentro tutti e due. Si rifanno da soli, ma rifarli costa una
    // notte di modello — e il registro È la storia di cosa è cambiato.
    writeFileSync(process.env.ABSENCE_MEMORY_FILE!, '{"titolo":"Manu day off"}\n');
    writeFileSync(process.env.ABSENCE_REGISTRY_FILE!, '{"versione":1,"eventi":{}}\n');
    const con = path.join(cartella, "con-assenze.zip");
    await writeBackupZip(con);
    expect(dentro(con)).toContain("assenze-modello.jsonl");
    expect(dentro(con)).toContain("assenze-calendario.json");
  });
});
