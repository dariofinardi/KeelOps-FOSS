// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `etc/config.json` è scritto a mano, quindi le due domande sono: **vale
 * subito** quando lo si salva, e **non rompe niente** quando è sbagliato. Un
 * riepilogo che smette di funzionare per una virgola di troppo in un file di
 * configurazione è peggio di un riepilogo senza calendario.
 */
const cartella = mkdtempSync(path.join(tmpdir(), "kancrm-config-"));
const percorso = path.join(cartella, "config.json");
// Prima dell'import: la configurazione legge l'ambiente quando il modulo si
// carica, e impostarla dopo non servirebbe a niente.
process.env.CONFIG_FILE = percorso;
const { fileConfig, resetFileConfig } = await import("../src/modules/config-file");

const scrivi = (contenuto: string) => {
  writeFileSync(percorso, contenuto);
  resetFileConfig();
};

afterEach(() => rmSync(percorso, { force: true }));

describe("la configurazione scritta a mano", () => {
  it("legge calendario e alias", () => {
    scrivi(
      JSON.stringify({
        assenze: { calendarUrl: "https://esempio/cal.ics", alias: { manu: "e@x.it" } },
      }),
    );
    expect(fileConfig().assenze.calendarUrl).toBe("https://esempio/cal.ics");
    expect(fileConfig().assenze.alias).toEqual({ manu: "e@x.it" });
  });

  it("un file che non c'è vale «nessuna configurazione», non un errore", () => {
    rmSync(percorso, { force: true });
    resetFileConfig();
    expect(fileConfig().assenze.calendarUrl).toBe("");
    expect(fileConfig().assenze.alias).toEqual({});
  });

  it("un JSON rotto non ferma niente: vale come vuoto", () => {
    scrivi('{ "assenze": { "alias": ');
    expect(fileConfig().assenze.calendarUrl).toBe("");
  });

  it("le sezioni mancanti hanno un valore, invece di far cadere il resto", () => {
    scrivi("{}");
    expect(fileConfig().assenze).toEqual({
      calendarUrl: "",
      alias: {},
      ignora: [],
      regole: { assenza: [], presenza: [] },
      codifiche: [],
    });
  });

  it("salvato il file, la modifica vale subito: niente riavvio", () => {
    scrivi(JSON.stringify({ assenze: { calendarUrl: "https://prima" } }));
    expect(fileConfig().assenze.calendarUrl).toBe("https://prima");
    // Senza `resetFileConfig`: è il cambio del file a farlo rileggere — data e
    // dimensione insieme, perché due salvataggi nello stesso millisecondo hanno
    // la stessa data (sotto carico succede, e il test lo ha scoperto).
    writeFileSync(percorso, JSON.stringify({ assenze: { calendarUrl: "https://dopo" } }));
    expect(fileConfig().assenze.calendarUrl).toBe("https://dopo");
  });
});
