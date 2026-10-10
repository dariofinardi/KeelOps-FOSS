// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { AttachmentType } from "@kancrm/shared";
import { attachmentStore } from "./store";

/**
 * **Il testo dentro un allegato.**
 *
 * PDF e DOCX si leggono qui, sul server, dal magazzino configurato (in
 * produzione il bucket). Provato su tutti gli allegati veri delle offerte
 * (21/08/2026): **tutti gli undici PDF hanno un vero livello di testo**, da
 * 1.400 a 2.700 caratteri per pagina, letti in meno di due secondi l'uno —
 * anche i `.p7m.pdf` firmati delle gare. Quindi niente OCR: il giorno che
 * arriva una scansione si vedrà da un testo quasi vuoto, e lo si dirà invece di
 * far finta di aver letto.
 *
 * **Google Drive no, e non per pigrizia**: il server non ha credenziali Drive —
 * l'SSO chiede `openid email profile` e non conserva token — mentre il browser
 * ha già `drive.readonly` per il selettore dei file. Il testo dei documenti su
 * Drive lo manda quindi la pagina, e qui arriva già estratto.
 */

/** Sotto questa soglia il documento non ha un vero testo: è un'immagine. */
const MINIMO_CARATTERI = 200;

export interface TestoAllegato {
  name: string;
  format: string;
  testo: string;
  saltato: string | null;
}

interface AllegatoDaLeggere {
  name: string;
  type: string;
  path: string | null;
  mimeType: string | null;
}

function formatoDi(allegato: AllegatoDaLeggere): "pdf" | "docx" | "drive" | "altro" {
  if (allegato.type === AttachmentType.LINK) return "drive";
  const nome = allegato.name.toLowerCase();
  if (nome.endsWith(".pdf") || allegato.mimeType === "application/pdf") return "pdf";
  if (nome.endsWith(".docx") || (allegato.mimeType ?? "").includes("wordprocessingml")) {
    return "docx";
  }
  return "altro";
}

/** Righe vuote e spazi doppi via: sono token pagati a 3,23 caratteri l'uno. */
function compatta(testo: string): string {
  return testo
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Il testo dentro dei byte, PDF o DOCX. Sta a parte perché serve due volte: per
 * gli allegati del magazzino e per i documenti che **arrivano da Drive** — il
 * browser li scarica con il suo token e li passa qui, perché il server con
 * Google non parla.
 */
export async function estraiDaByte(
  nome: string,
  mimeType: string | null,
  dati: Buffer,
): Promise<TestoAllegato> {
  const format = formatoDi({ name: nome, type: "FILE", path: null, mimeType });
  const vuoto = (saltato: string): TestoAllegato => ({ name: nome, format, testo: "", saltato });
  if (format !== "pdf" && format !== "docx") return vuoto("Formato che non si legge");
  try {
    let testo = "";
    if (format === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(dati));
      testo = (await extractText(pdf, { mergePages: true })).text;
    } else {
      testo = (await mammoth.extractRawText({ buffer: dati })).value;
    }
    testo = compatta(testo);
    return testo.length < MINIMO_CARATTERI
      ? vuoto("Nessun testo: probabilmente è una scansione")
      : { name: nome, format, testo, saltato: null };
  } catch {
    return vuoto("Lettura non riuscita");
  }
}

export async function leggiAllegato(allegato: AllegatoDaLeggere): Promise<TestoAllegato> {
  const format = formatoDi(allegato);
  const vuoto = (saltato: string): TestoAllegato => ({
    name: allegato.name,
    format,
    testo: "",
    saltato,
  });
  if (format === "drive") return vuoto("Su Drive: aprilo dal pannello e chiedi di rileggere");
  if (format === "altro") return vuoto("Formato che non si legge");
  if (!allegato.path) return vuoto("File non trovato nel magazzino");

  let dati: Buffer;
  try {
    dati = await attachmentStore().read(allegato.path);
  } catch {
    return vuoto("File non leggibile dal magazzino");
  }

  // Un PDF che non restituisce testo è quasi sempre una scansione: `estraiDaByte`
  // lo dice, invece di far credere che il contratto non contenga niente.
  return estraiDaByte(allegato.name, allegato.mimeType, dati);
}
