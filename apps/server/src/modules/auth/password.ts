// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { hash, verify } from "@node-rs/argon2";
import { config } from "../../config";

/**
 * Password: **non si cifrano, si sottopongono ad hash**. Cifrare vorrebbe dire
 * poterle rileggere, e nessuno — nemmeno chi amministra — deve poter risalire
 * alla password di un utente.
 *
 * L'algoritmo è **argon2id** (@node-rs/argon2), con i parametri consigliati da
 * OWASP: 19 MiB di memoria, 2 passate, 1 thread. Ogni hash porta con sé il
 * proprio **sale casuale**, generato a ogni scrittura: due persone con la stessa
 * password hanno hash diversi, e le tabelle precalcolate non servono a niente.
 * Il formato salvato è `$argon2id$v=19$m=19456,t=2,p=1$<sale>$<hash>`.
 *
 * ## Il pepe (segreto fuori dal database)
 *
 * Il sale sta accanto all'hash: se qualcuno porta via il file `app.db` ha
 * entrambi, e può provare a indovinare le password a forza bruta (lentamente,
 * grazie ad argon2, ma può). Il **pepe** è un segreto che *non* sta nel
 * database: senza di lui gli hash non si verificano nemmeno conoscendo la
 * password giusta. Chi ruba il solo database resta a mani vuote.
 *
 * Si attiva indicando `PASSWORD_PEPPER_FILE`: un file che il **processo** legge
 * all'avvio e che nessun altro deve poter leggere — né il browser (non sta sotto
 * la cartella servita), né i backup (non sta sotto `data/`). Questo è il senso
 * di "non raggiungibile": il server deve leggerlo per forza, altrimenti non
 * potrebbe verificare le password; a non doverci arrivare sono il web e chi non
 * è il servizio.
 *
 * Il file può contenere il segreto in chiaro oppure un JSON con la chiave
 * `passwordPepper`, così può essere il `config.json` del deploy. La collocazione
 * più protetta resta fuori dall'installazione (`/etc/kancrm/pepper`, permessi
 * 400); metterlo nella cartella del servizio è comodo e accettabile, purché
 * **non** dentro `app/` — quella la riscrive `deploy.sh` con `--delete` a ogni
 * rilascio, e il file sparirebbe chiudendo fuori tutti.
 *
 * **Attenzione, è irreversibile**: perso il pepe, nessuna password funziona più
 * e vanno tutte reimpostate. Va custodito come una chiave, e **fuori** dallo zip
 * di backup — che contiene il database, cioè proprio ciò da cui deve restare
 * separato.
 */

let pepper: Buffer | null | undefined;

/** Letto una volta sola, alla prima password trattata. */
function currentPepper(): Buffer | null {
  if (pepper === undefined) {
    const file = config.passwordPepperFile;
    if (!file) {
      pepper = null;
    } else {
      assertPepperFileIsolated(file);
      const content = readPepperSecret(file);
      if (content.length < 16) {
        throw new Error(
          `Il pepe delle password (${file}) è troppo corto: servono almeno 16 caratteri casuali`,
        );
      }
      pepper = Buffer.from(content, "utf8");
    }
  }
  return pepper;
}

/**
 * Segreto in chiaro, oppure `{"passwordPepper": "..."}` per chi preferisce un
 * file di configurazione unico. Le altre chiavi del JSON vengono ignorate.
 */
function readPepperSecret(file: string): string {
  const raw = readFileSync(file, "utf8").trim();
  if (!raw.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(raw) as { passwordPepper?: unknown };
    if (typeof parsed.passwordPepper === "string") return parsed.passwordPepper.trim();
    throw new Error(`Nel file ${file} manca la chiave "passwordPepper"`);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Il file ${file} non è un JSON valido`);
    throw error;
  }
}

/**
 * Dove il pepe **non** può stare:
 *
 * - `data/`: finisce nello zip di backup insieme al database, cioè proprio ciò
 *   da cui deve restare separato;
 * - la cartella pubblica: verrebbe servita al browser;
 * - l'albero dei sorgenti: `deploy.sh` lo sincronizza con `--delete`, quindi il
 *   file sparirebbe al primo rilascio e nessuno riuscirebbe più ad accedere.
 *
 * Va bene invece la cartella del servizio accanto a `app/` e `data/`: non viene
 * né servita, né sincronizzata, né messa nei backup.
 */
function assertPepperFileIsolated(file: string): void {
  const resolved = path.resolve(file);
  const vietate: Array<[string, string]> = [
    [path.resolve(config.uploadsDir, ".."), "finirebbe nello zip di backup insieme al database"],
    [path.resolve(import.meta.dirname, "../../../public"), "verrebbe servito al browser"],
    [
      path.resolve(import.meta.dirname, "../../../../.."),
      "verrebbe cancellato al primo deploy (rsync --delete sui sorgenti)",
    ],
  ];
  for (const [dir, perche] of vietate) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) {
      throw new Error(
        `Il pepe delle password non può stare in ${dir}: ${perche}. ` +
          "Mettilo nella cartella del servizio accanto ad app/ e data/, o in /etc/kancrm/, " +
          "leggibile solo dall'utente del servizio.",
      );
    }
  }
}

/** Solo per i test: azzera la cache del pepe. */
export function resetPepperCache(): void {
  pepper = undefined;
}

/**
 * `async` di proposito: un pepe mal configurato deve arrivare a chi chiama come
 * promessa rifiutata, non come eccezione lanciata prima ancora di restituire la
 * promessa — chi si limita a `.catch()` non la vedrebbe passare.
 */
export async function hashPassword(password: string): Promise<string> {
  const secret = currentPepper();
  return hash(password, secret ? { secret } : undefined);
}

export interface PasswordCheck {
  ok: boolean;
  /**
   * La password è giusta ma l'hash è stato creato **senza** pepe: va riscritto
   * al primo accesso utile. È così che si passa al pepe senza chiedere a nessuno
   * di reimpostare la propria password.
   */
  needsUpgrade: boolean;
}

export async function checkPassword(
  passwordHash: string,
  password: string,
): Promise<PasswordCheck> {
  const secret = currentPepper();
  try {
    if (await verify(passwordHash, password, secret ? { secret } : undefined)) {
      return { ok: true, needsUpgrade: false };
    }
  } catch {
    // Hash illeggibile o pepe sbagliato: si prova la strada di prima.
  }
  // Con il pepe attivo, gli hash scritti prima non lo contengono: restano
  // validi finché non si riscrivono, altrimenti attivare il pepe chiuderebbe
  // fuori tutti in un colpo solo.
  if (secret) {
    try {
      if (await verify(passwordHash, password)) return { ok: true, needsUpgrade: true };
    } catch {
      // niente da fare
    }
  }
  return { ok: false, needsUpgrade: false };
}

/** Verifica secca, per i punti che non possono riscrivere l'hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return (await checkPassword(passwordHash, password)).ok;
}
