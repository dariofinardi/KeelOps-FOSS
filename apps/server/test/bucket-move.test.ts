// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  traslocaCartella,
  traslocoImpossibile,
  type BucketPerTrasloco,
  type OggettoBucket,
} from "../src/modules/attachments/bucket-move";

/**
 * Il trasloco di Jugaad dalla radice di gs://keelops a istanze/jugaad
 * (02/10/2026), provato su un bucket finto: in quello vero ci sono i documenti
 * di due clienti.
 */
function bucketFinto(iniziale: Record<string, string>, guasti: { copiaStorta?: string } = {}) {
  const oggetti = new Map(Object.entries(iniziale));
  const descrivi = (name: string): OggettoBucket => {
    const dati = oggetti.get(name)!;
    return { name, size: dati.length, crc32c: `crc:${dati}` };
  };
  const bucket: BucketPerTrasloco = {
    list: async (prefix) =>
      [...oggetti.keys()].filter((n) => !prefix || n.startsWith(`${prefix}/`)).map(descrivi),
    meta: async (name) => (oggetti.has(name) ? descrivi(name) : null),
    copy: async (from, to) => {
      oggetti.set(to, guasti.copiaStorta === from ? "rovinato" : oggetti.get(from)!);
    },
    remove: async (name) => {
      oggetti.delete(name);
    },
  };
  return { bucket, oggetti };
}

const BUCKET_VERO_IN_PICCOLO = {
  "t1/contratto.pdf": "contratto",
  "t2/offerta.docx": "offerta",
  "backup/2026-10-01.sql.gz": "dump",
  "_branding/logo.png": "logo",
  "istanze/studiorossi/x/fattura.pdf": "fattura dello studio",
};

describe("trasloco di un'istanza dentro il bucket", () => {
  it("dalla radice sposta tutto quello di Jugaad, e niente delle altre istanze", async () => {
    const { bucket, oggetti } = bucketFinto(BUCKET_VERO_IN_PICCOLO);
    const esito = await traslocaCartella(bucket, "", "istanze/jugaad", { esegui: true });
    expect(esito).toMatchObject({
      totali: 4,
      copiati: 4,
      giaArrivati: 0,
      conflitti: [],
      errori: [],
    });
    expect([...oggetti.keys()].sort()).toEqual([
      "istanze/jugaad/_branding/logo.png",
      "istanze/jugaad/backup/2026-10-01.sql.gz",
      "istanze/jugaad/t1/contratto.pdf",
      "istanze/jugaad/t2/offerta.docx",
      "istanze/studiorossi/x/fattura.pdf",
    ]);
    expect(oggetti.get("istanze/jugaad/t1/contratto.pdf")).toBe("contratto");
  });

  it("a secco non tocca niente, e dice cosa farebbe", async () => {
    const { bucket, oggetti } = bucketFinto(BUCKET_VERO_IN_PICCOLO);
    const esito = await traslocaCartella(bucket, "", "istanze/jugaad", { esegui: false });
    expect(esito.copiati).toBe(4);
    expect([...oggetti.keys()].sort()).toEqual(Object.keys(BUCKET_VERO_IN_PICCOLO).sort());
  });

  it("si rilancia: ciò che è arrivato identico perde solo l'originale", async () => {
    const { bucket, oggetti } = bucketFinto({
      "t1/contratto.pdf": "contratto",
      "istanze/jugaad/t1/contratto.pdf": "contratto",
    });
    const esito = await traslocaCartella(bucket, "", "istanze/jugaad", { esegui: true });
    expect(esito).toMatchObject({ copiati: 0, giaArrivati: 1 });
    expect([...oggetti.keys()]).toEqual(["istanze/jugaad/t1/contratto.pdf"]);
  });

  it("un file diverso già a destinazione non si tocca: lo decide una persona", async () => {
    const { bucket, oggetti } = bucketFinto({
      "t1/contratto.pdf": "versione A",
      "istanze/jugaad/t1/contratto.pdf": "versione B",
    });
    const esito = await traslocaCartella(bucket, "", "istanze/jugaad", { esegui: true });
    expect(esito.conflitti).toEqual(["t1/contratto.pdf"]);
    expect(oggetti.get("t1/contratto.pdf")).toBe("versione A");
    expect(oggetti.get("istanze/jugaad/t1/contratto.pdf")).toBe("versione B");
  });

  it("una copia che non corrisponde lascia l'originale al suo posto", async () => {
    const { bucket, oggetti } = bucketFinto(
      { "t1/contratto.pdf": "contratto" },
      { copiaStorta: "t1/contratto.pdf" },
    );
    const esito = await traslocaCartella(bucket, "", "istanze/jugaad", { esegui: true });
    expect(esito.errori).toHaveLength(1);
    expect(oggetti.get("t1/contratto.pdf")).toBe("contratto");
  });

  it("si rifiuta di spostare una cartella dentro sé stessa o sulla radice", () => {
    expect(traslocoImpossibile("", "jugaad")).toMatch(/istanze/);
    expect(traslocoImpossibile("istanze/a", "istanze/a/b")).toMatch(/dentro/);
    expect(traslocoImpossibile("istanze/a", "")).toMatch(/radice/);
    expect(traslocoImpossibile("istanze/a", "istanze/a")).toMatch(/stessa/);
    expect(traslocoImpossibile("", "istanze/jugaad")).toBeNull();
  });
});
