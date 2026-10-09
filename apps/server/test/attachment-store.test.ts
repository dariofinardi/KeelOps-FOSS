import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { localStore, safeKey, withFallback } from "../src/modules/attachments/store";
import { parseGcsUri } from "../src/modules/attachments/gcs-store";
import { moveAttachments } from "../src/modules/attachments/move";
import { parseRange } from "../src/modules/attachments/routes";
import { viewableKind } from "@kancrm/shared";

/**
 * Il magazzino degli allegati: la stessa interfaccia sopra una cartella e sopra
 * un bucket (18/08/2026). Qui si prova la parte che non ha bisogno della rete —
 * il disco, la validazione delle chiavi, la lettura dell'indirizzo `gs://` e lo
 * spostamento da un magazzino all'altro, che è la manovra rischiosa.
 */
const temp = mkdtempSync(path.join(tmpdir(), "keelops-store-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("chiavi", () => {
  it("normalizza le barre e toglie quella iniziale", () => {
    expect(safeKey("/task/file.pdf")).toBe("task/file.pdf");
    expect(safeKey("task\\file.pdf")).toBe("task/file.pdf");
  });

  it("rifiuta le risalite e i pezzi vuoti", () => {
    // La chiave arriva anche da fuori (nome file, indirizzo): qui si chiude.
    expect(() => safeKey("../etc/passwd")).toThrow();
    expect(() => safeKey("task/../../fuori.pdf")).toThrow();
    expect(() => safeKey("task//file.pdf")).toThrow();
    expect(() => safeKey("")).toThrow();
  });
});

describe("indirizzo del bucket", () => {
  it("legge bucket e sottocartella da gs://", () => {
    expect(parseGcsUri("gs://keelops")).toEqual({ bucket: "keelops", prefix: "" });
    expect(parseGcsUri("gs://keelops/")).toEqual({ bucket: "keelops", prefix: "" });
    expect(parseGcsUri(" gs://keelops/prod/allegati ")).toEqual({
      bucket: "keelops",
      prefix: "prod/allegati",
    });
  });

  it("non accetta quello che bucket non è", () => {
    expect(parseGcsUri("keelops")).toBeNull();
    expect(parseGcsUri("https://storage.googleapis.com/keelops")).toBeNull();
    expect(parseGcsUri("gs://")).toBeNull();
  });
});

describe("magazzino su disco", () => {
  const store = localStore(path.join(temp, "uno"));

  it("scrive, rilegge, misura e cancella", async () => {
    await store.write("cmXYZ/relazione.pdf", Buffer.from("ciao"));
    expect((await store.read("cmXYZ/relazione.pdf")).toString()).toBe("ciao");
    expect(await store.size("cmXYZ/relazione.pdf")).toBe(4);
    expect(await store.exists("cmXYZ/relazione.pdf")).toBe(true);

    await store.remove("cmXYZ/relazione.pdf");
    expect(await store.exists("cmXYZ/relazione.pdf")).toBe(false);
    // Cancellare due volte non è un errore: la pulizia degli orfani ci passa.
    await store.remove("cmXYZ/relazione.pdf");
  });

  it("la dimensione di un file che non c'è è null, non zero", async () => {
    // Zero vorrebbe dire "file vuoto", e la rotta di download manderebbe un
    // Content-Length a un file inesistente invece di rispondere 404.
    expect(await store.size("mai/esistito.pdf")).toBeNull();
  });

  it("elenca tutto con le sottocartelle, con la chiave nella forma giusta", async () => {
    await store.write("task-a/uno.txt", Buffer.from("a"));
    await store.write("task-a/_inline/due.png", Buffer.from("bb"));
    await store.write("_avatars/tre.png", Buffer.from("ccc"));
    const keys = (await store.list()).map((f) => f.key).sort();
    expect(keys).toEqual(["_avatars/tre.png", "task-a/_inline/due.png", "task-a/uno.txt"]);
    expect((await store.list()).find((f) => f.key === "_avatars/tre.png")?.size).toBe(3);
  });
});

describe("spostamento tra magazzini", () => {
  it("copia, cancella l'originale e racconta cosa ha fatto", async () => {
    const from = localStore(path.join(temp, "vecchia"));
    const to = localStore(path.join(temp, "nuova"));
    await from.write("task/uno.pdf", Buffer.from("primo"));
    await from.write("task/due.pdf", Buffer.from("secondo"));

    const report = await moveAttachments(from, to);
    expect(report).toMatchObject({ totali: 2, spostati: 2, saltati: 0, errori: [] });
    expect((await to.read("task/uno.pdf")).toString()).toBe("primo");
    // L'originale se ne va solo dopo che la copia è riuscita.
    expect(await from.exists("task/uno.pdf")).toBe(false);
  });

  it("si può rilanciare: quello che è già arrivato non si ricopia", async () => {
    const from = localStore(path.join(temp, "a"));
    const to = localStore(path.join(temp, "b"));
    await from.write("x.pdf", Buffer.from("dato"));
    await to.write("x.pdf", Buffer.from("dato"));
    await from.write("y.pdf", Buffer.from("altro"));

    const report = await moveAttachments(from, to);
    expect(report.saltati).toBe(1);
    expect(report.spostati).toBe(1);
  });

  it("in prova a vuoto non tocca niente", async () => {
    const from = localStore(path.join(temp, "c"));
    const to = localStore(path.join(temp, "d"));
    await from.write("z.pdf", Buffer.from("dato"));

    const report = await moveAttachments(from, to, { dryRun: true });
    expect(report.spostati).toBe(1);
    expect(await from.exists("z.pdf")).toBe(true);
    expect(await to.exists("z.pdf")).toBe(false);
  });

  it("verso se stesso non fa niente", async () => {
    const store = localStore(path.join(temp, "stessa"));
    await store.write("w.pdf", Buffer.from("dato"));
    expect(await moveAttachments(store, store)).toMatchObject({ totali: 0, spostati: 0 });
    expect(await store.exists("w.pdf")).toBe(true);
  });
});

describe("richieste parziali (Range)", () => {
  it("legge le forme che i lettori usano davvero", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
    // Aperto a destra: "da qui alla fine", ed è la richiesta che parte per prima.
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    // Aperto a sinistra: gli ultimi N byte (i lettori li chiedono per l'indice
    // dei filmati, che in certi formati sta in fondo).
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    // Oltre la fine del file si taglia, non si sbaglia.
    expect(parseRange("bytes=0-99999", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("un intervallo senza senso è un 416, non il file intero", () => {
    expect(parseRange("bytes=2000-3000", 1000)).toBe("non-valido");
    expect(parseRange("bytes=500-100", 1000)).toBe("non-valido");
    expect(parseRange("righe=0-10", 1000)).toBe("non-valido");
    expect(parseRange("bytes=-", 1000)).toBe("non-valido");
  });
});

describe("cosa si guarda qui dentro", () => {
  it("video e audio si riconoscono dal tipo e dall'estensione", () => {
    expect(viewableKind("video/mp4", "demo.mp4")).toBe("video");
    // `.mov` e `.mkv` arrivano spesso senza tipo dichiarato dal browser.
    expect(viewableKind("", "registrazione.mov")).toBe("video");
    expect(viewableKind(null, "schermo.mkv")).toBe("video");
    expect(viewableKind("audio/mpeg", "memo.mp3")).toBe("audio");
    expect(viewableKind(null, "nota.m4a")).toBe("audio");
    // Quello che non si sa disegnare resta da scaricare.
    expect(viewableKind("application/zip", "log.zip")).toBeNull();
  });
});

describe("rete di sicurezza durante il passaggio", () => {
  it("legge dal vecchio magazzino ciò che nel nuovo non è ancora arrivato", async () => {
    const bucket = localStore(path.join(temp, "finto-bucket"));
    const disco = localStore(path.join(temp, "vecchio-disco"));
    await disco.write("task/storico.pdf", Buffer.from("vecchio"));
    const store = withFallback(bucket, disco);

    // Non spostato: si legge lo stesso, e la dimensione è quella giusta.
    expect((await store.read("task/storico.pdf")).toString()).toBe("vecchio");
    expect(await store.size("task/storico.pdf")).toBe(7);
    expect(await store.exists("task/storico.pdf")).toBe(true);

    // Quello nuovo nasce nel magazzino vero.
    await store.write("task/nuovo.pdf", Buffer.from("nuovo"));
    expect(await bucket.exists("task/nuovo.pdf")).toBe(true);
    expect(await disco.exists("task/nuovo.pdf")).toBe(false);

    // L'elenco conta il magazzino vero: è quello che la pagina mostra.
    expect((await store.list()).map((f) => f.key)).toEqual(["task/nuovo.pdf"]);

    // Cancellare toglie da tutti e due: un file "eliminato" che riappare
    // perché era rimasto nella vecchia cartella sarebbe peggio.
    await store.remove("task/storico.pdf");
    expect(await disco.exists("task/storico.pdf")).toBe(false);
  });
});

describe("spostare VERSO un magazzino con la rete di sicurezza", () => {
  it("non si salta i file solo perché la rete li vede nell'origine", async () => {
    // Il difetto del 18/08/2026: la destinazione era il bucket *con* la rete di
    // sicurezza sulla cartella, quindi `exists()` rispondeva di sì per ogni
    // file dell'origine e lo spostamento diceva "già presenti, niente da fare"
    // con il bucket vuoto.
    const disco = localStore(path.join(temp, "origine-rete"));
    const bucket = localStore(path.join(temp, "destinazione-rete"));
    await disco.write("task/atto.pdf", Buffer.from("contenuto"));

    const conRete = withFallback(bucket, disco);
    expect(await moveAttachments(disco, conRete)).toMatchObject({ spostati: 0, saltati: 1 });
    expect(await bucket.exists("task/atto.pdf")).toBe(false);

    // Senza rete, cioè come lo chiamano la rotta e lo script, si sposta davvero.
    expect(await moveAttachments(disco, bucket)).toMatchObject({ spostati: 1, saltati: 0 });
    expect((await bucket.read("task/atto.pdf")).toString()).toBe("contenuto");
  });
});
