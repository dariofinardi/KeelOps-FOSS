// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config";

/**
 * **`etc/config.json`**: la configurazione che si scrive a mano.
 *
 * Ci stanno le cose che descrivono *questa installazione* e che cambiano senza
 * un rilascio: l'indirizzo del calendario delle assenze e i soprannomi con cui
 * le persone ci sono scritte sopra.
 *
 * **Dove**: fuori da `app/`, perché il deploy riscrive quella cartella con
 * `rsync --delete` e un file lì dentro sparirebbe a ogni pubblicazione. In
 * produzione è `etc/config.json` nella cartella del servizio, accanto a `data/`
 * e `.env`; in sviluppo è `etc/config.json` nella radice del progetto. Si può
 * indicare altrove con `CONFIG_FILE`.
 *
 * **Non entra in git**: contiene l'indirizzo segreto del calendario, che è una
 * credenziale. Nel repository c'è `etc/config.example.json`, senza segreti.
 *
 * **Si rilegge da sé**: si guarda la data di modifica a ogni uso e si riapre
 * solo quando cambia. Correggere un alias ha effetto subito, senza riavviare il
 * servizio, e non costa una lettura da disco a ogni richiesta.
 */

const schema = z.object({
  assenze: z
    .object({
      /** Indirizzo iCal **segreto** del calendario delle assenze. */
      calendarUrl: z.string().default(""),
      /**
       * Come le persone sono nominate sul calendario: `"manu": "e.bassi@…"`.
       * La chiave è la parola che compare nel titolo, il valore è l'email
       * dell'utente — che non cambia quando qualcuno cambia nome.
       */
      alias: z.record(z.string(), z.string()).default({}),
      /**
       * Le parole che decidono cosa vuol dire un evento. Stanno qui perché il
       * vocabolario di un'azienda cresce — arriva «congedo», arriva «fiera» —
       * e aggiungerne una non deve costare un rilascio. Vuote: valgono quelle
       * di casa (`REGOLE_DI_CASA` in `timesheet/absences.ts`).
       */
      /**
       * **Parole che dicono «questo evento non è di nessuno dei nostri».**
       *
       * Servono per gli omonimi e gli estranei: sul calendario c'è «Alex
       * Neri in ufficio», e l'Alex dell'ufficio è Alex Bianchi. Oggi quella
       * riga si ignora per fortuna — non contiene parole note — ma «Alex
       * Neri ferie» ruberebbe una giornata a chi non c'entra. Basta un
       * cognome qui e l'evento non tocca nessuno (21/08/2026).
       */
      ignora: z.array(z.string()).default([]),
      regole: z
        .object({
          /** Parole che dichiarano un'**assenza**: ferie, permesso, malattia… */
          assenza: z.array(z.string()).default([]),
          /**
           * Parole che dichiarano **presenza altrove**: smart working,
           * trasferta. Vincono sull'assenza — «SW» non toglie ore a nessuno.
           */
          presenza: z.array(z.string()).default([]),
        })
        .default({ assenza: [], presenza: [] }),
      /**
       * **Le codifiche**: sigla, tipo e descrizione (`FE` Ferie, `SW` Smart
       * working). Vuote: valgono quelle di casa (`CODIFICHE_DI_CASA`). Le
       * scrive il pannello delle codifiche del plugin Presenze (18/09/2026).
       */
      codifiche: z
        .array(
          z.object({
            codice: z.string(),
            tipo: z.enum(["assenza", "presenza"]),
            descrizione: z.string(),
          }),
        )
        .default([]),
    })
    .default({
      calendarUrl: "",
      alias: {},
      ignora: [],
      regole: { assenza: [], presenza: [] },
      codifiche: [],
    }),
});

export type FileConfig = z.infer<typeof schema>;

const VUOTA: FileConfig = {
  assenze: {
    calendarUrl: "",
    alias: {},
    ignora: [],
    regole: { assenza: [], presenza: [] },
    codifiche: [],
  },
};

let cache: { valore: FileConfig; percorso: string; impronta: string } | null = null;

/** Dov'è il file, secondo la configurazione o la convenzione. */
export function configFilePath(): string {
  return config.configFile || path.join(config.rootDir, "etc", "config.json");
}

/**
 * La configurazione scritta a mano. Se il file non c'è, o è rotto, torna quella
 * vuota: **l'applicazione funziona lo stesso** — senza calendario le assenze
 * restano dedotte, come prima che il file esistesse.
 */
export function fileConfig(): FileConfig {
  const percorso = configFilePath();
  let impronta: string;
  try {
    const stato = statSync(percorso);
    // Data **e** dimensione: la sola data ha una granularità che su certi
    // filesystem è di un secondo, e due salvataggi ravvicinati passerebbero
    // inosservati — il file resterebbe quello vecchio senza dirlo.
    impronta = `${stato.mtimeMs}:${stato.size}`;
  } catch {
    return VUOTA;
  }
  if (cache && cache.percorso === percorso && cache.impronta === impronta) return cache.valore;
  try {
    const letto = schema.parse(JSON.parse(readFileSync(percorso, "utf8")));
    cache = { valore: letto, percorso, impronta };
    return letto;
  } catch {
    // Un JSON rotto non deve fermare i riepiloghi: si torna alla configurazione
    // vuota, e chi guarda legge "nessun calendario" invece di un errore opaco.
    return VUOTA;
  }
}

/** Solo per i test: dimentica quello che ha in mano. */
export function resetFileConfig(): void {
  cache = null;
}

/**
 * **Scrive la sezione `assenze`** del file (06/09/2026: la pagina del super
 * admin nel plugin Presenze). Rilegge il JSON grezzo e sostituisce solo quella
 * sezione — le chiavi che questo codice non conosce restano dove sono — e
 * scrive su un file accanto, poi rinomina: un salvataggio a metà non lascia
 * un JSON rotto, che il lettore tratterebbe come «nessun calendario».
 * Le chiavi che non arrivano — l'indirizzo del calendario, le codifiche —
 * restano quelle che c'erano.
 */
export function scriviAssenzeConfig(assenze: Partial<FileConfig["assenze"]>): FileConfig {
  const percorso = configFilePath();
  let grezzo: Record<string, unknown> = {};
  try {
    grezzo = JSON.parse(readFileSync(percorso, "utf8")) as Record<string, unknown>;
  } catch {
    grezzo = {};
  }
  const prima = fileConfig().assenze;
  // Ciò che non arriva resta com'era: la pagina della configurazione e il
  // pannello delle codifiche scrivono ciascuno la propria parte.
  const nuova: FileConfig["assenze"] = { ...prima, ...assenze };
  const contenuto = { ...grezzo, assenze: nuova };
  mkdirSync(path.dirname(percorso), { recursive: true });
  const temporaneo = `${percorso}.${process.pid}.tmp`;
  writeFileSync(temporaneo, `${JSON.stringify(contenuto, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaneo, percorso);
  cache = null;
  return fileConfig();
}
