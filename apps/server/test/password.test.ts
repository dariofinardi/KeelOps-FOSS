// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(path.join(tmpdir(), "kancrm-test-password-"));
// La cartella dei dati sta altrove: serve al controllo che il pepe non finisca
// dentro ciò che viene messo nei backup.
process.env.UPLOADS_DIR = path.join(tempDir, "data", "uploads");

const pepperFile = path.join(tempDir, "pepe");
writeFileSync(pepperFile, "un-segreto-lungo-abbastanza-123\n");

const { checkPassword, hashPassword, resetPepperCache } =
  await import("../src/modules/auth/password");
const { config } = await import("../src/config");

/** Il pepe si legge dalla configurazione: nei test lo si cambia a mano. */
function usaPepe(file: string): void {
  (config as { passwordPepperFile: string }).passwordPepperFile = file;
  resetPepperCache();
}

beforeAll(() => usaPepe(""));
afterAll(() => {
  usaPepe("");
  rmSync(tempDir, { recursive: true, force: true });
});

describe("archiviazione delle password", () => {
  it("si salva un hash argon2id con sale casuale, non la password", async () => {
    const hash = await hashPassword("password-di-prova-1");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("password-di-prova-1");

    // Stessa password, hash diverso: il sale è generato a ogni scrittura, quindi
    // due utenti con la stessa password non si riconoscono guardando il database.
    const altro = await hashPassword("password-di-prova-1");
    expect(altro).not.toBe(hash);
    expect((await checkPassword(hash, "password-di-prova-1")).ok).toBe(true);
    expect((await checkPassword(hash, "password-di-prova-2")).ok).toBe(false);
  });
});

describe("pepe: il segreto che non sta nel database", () => {
  it("con il pepe attivo, chi ha solo il database non verifica nulla", async () => {
    usaPepe(pepperFile);
    const conPepe = await hashPassword("password-di-prova-1");
    expect((await checkPassword(conPepe, "password-di-prova-1")).ok).toBe(true);

    // Stesso hash, pepe assente (è la situazione di chi ruba il solo app.db):
    // la password giusta non basta più.
    usaPepe("");
    expect((await checkPassword(conPepe, "password-di-prova-1")).ok).toBe(false);
  });

  it("gli hash scritti prima restano validi e si riscrivono al primo accesso", async () => {
    // Attivare il pepe non deve chiudere fuori tutti in un colpo solo.
    usaPepe("");
    const vecchio = await hashPassword("password-di-prova-1");

    usaPepe(pepperFile);
    const esito = await checkPassword(vecchio, "password-di-prova-1");
    expect(esito.ok).toBe(true);
    expect(esito.needsUpgrade).toBe(true); // il login lo riscrive con il pepe

    // Riscritto: da lì in poi è protetto e non chiede più aggiornamenti.
    const nuovo = await hashPassword("password-di-prova-1");
    expect((await checkPassword(nuovo, "password-di-prova-1")).needsUpgrade).toBe(false);
  });

  it("un pepe diverso non apre: non è una password alternativa", async () => {
    usaPepe(pepperFile);
    const hash = await hashPassword("password-di-prova-1");
    const altroPepe = path.join(tempDir, "pepe-sbagliato");
    writeFileSync(altroPepe, "un-altro-segreto-lungo-abbastanza-456");
    usaPepe(altroPepe);
    // L'hash è nato senza il pepe giusto: nemmeno la strada di compatibilità
    // (verifica senza pepe) lo apre.
    expect((await checkPassword(hash, "password-di-prova-1")).ok).toBe(false);
  });

  it("il segreto può stare dentro un config.json", async () => {
    // Comodo per chi tiene un solo file di configurazione nella cartella del
    // servizio: le altre chiavi non danno fastidio.
    const configFile = path.join(tempDir, "config.json");
    writeFileSync(
      configFile,
      JSON.stringify({
        nota: "configurazione del servizio",
        passwordPepper: "segreto-lungo-abbastanza-789",
      }),
    );
    usaPepe(configFile);
    const hash = await hashPassword("password-di-prova-1");
    expect((await checkPassword(hash, "password-di-prova-1")).ok).toBe(true);
  });

  it("un config.json senza la chiave giusta lo dice", async () => {
    const senzaChiave = path.join(tempDir, "config-vuoto.json");
    writeFileSync(senzaChiave, JSON.stringify({ altro: "valore" }));
    usaPepe(senzaChiave);
    await expect(hashPassword("password-di-prova-1")).rejects.toThrow(/passwordPepper/);
  });

  it("nell'albero dei sorgenti non si può mettere: il deploy lo cancellerebbe", async () => {
    // rsync --delete riscrive app/ a ogni rilascio: il file sparirebbe e
    // nessuno riuscirebbe più ad accedere.
    const dentroSorgenti = path.resolve(import.meta.dirname, "../pepe-di-prova");
    writeFileSync(dentroSorgenti, "un-segreto-lungo-abbastanza-123");
    usaPepe(dentroSorgenti);
    await expect(hashPassword("password-di-prova-1")).rejects.toThrow(/deploy/);
    rmSync(dentroSorgenti, { force: true });
  });

  it("un pepe troppo corto non si accetta", async () => {
    const corto = path.join(tempDir, "pepe-corto");
    writeFileSync(corto, "breve");
    usaPepe(corto);
    await expect(hashPassword("password-di-prova-1")).rejects.toThrow(/troppo corto/);
  });

  it("il pepe non può stare dove finisce nei backup", async () => {
    // data/ entra nello zip di backup insieme al database: tenerci il segreto
    // vanificherebbe tutto — chi prende il backup avrebbe di nuovo entrambi.
    const dentroData = path.join(tempDir, "data", "pepe");
    mkdirSync(path.dirname(dentroData), { recursive: true });
    writeFileSync(dentroData, "un-segreto-lungo-abbastanza-123");
    usaPepe(dentroData);
    await expect(hashPassword("password-di-prova-1")).rejects.toThrow(/non può stare/);
  });
});
