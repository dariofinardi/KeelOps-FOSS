// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { prisma } from "../db";

/**
 * La firma HMAC dei token e dei link, in un punto solo.
 *
 * La usano il download degli allegati (`attachments/download-token.ts`) e il
 * link "Segna come fatto" del calendario (`calendar/done-link.ts`): entrambi
 * mettono una firma su un payload e la verificano più tardi, senza sessione. Il
 * primitivo era copiato in tutti e due — e una rotazione della chiave o un
 * cambio di algoritmo va fatto una volta, non ricordato in ogni copia.
 *
 * **Il segreto deve sopravvivere ai riavvii** (18/08/2026). Prima, senza
 * `DOWNLOAD_TOKEN_SECRET` nell'ambiente, se ne generava uno casuale a ogni
 * avvio: innocuo per i token di download, che vivono minuti, ma i link del
 * calendario vivono **mesi dentro il calendario di qualcuno**. Ogni deploy li
 * spegneva tutti in silenzio, e la pagina dava la colpa a un calendario
 * revocato. Ora, se l'ambiente non lo dice, il segreto si genera **una volta** e
 * si conserva in banca dati.
 *
 * In banca dati e non in un file, a differenza del pepe delle password: quello
 * deve reggere anche al furto di un dump, mentre qui accanto ci sono già i
 * token dei calendari — che sono la stessa capacità. Un `.env` con
 * `DOWNLOAD_TOKEN_SECRET` resta la via migliore e ha la precedenza.
 */
const SECRET_KEY = "security.signingSecret";

/** Ultima spiaggia: un processo che firma senza essere passato dall'avvio. */
let fallback: string | null = null;
let persisted: string | null = null;

function secret(): string {
  if (config.downloadTokenSecret) return config.downloadTokenSecret;
  if (persisted) return persisted;
  // Succede solo negli script e nei test che non chiamano `initSigningSecret`:
  // le firme valgono finché vive il processo, come prima.
  fallback ??= randomBytes(32).toString("hex");
  return fallback;
}

/**
 * Carica (o crea) il segreto persistente. Va chiamata all'avvio, prima di
 * servire richieste. Non fa niente se l'ambiente ne impone già uno.
 */
export async function initSigningSecret(): Promise<"ambiente" | "banca dati"> {
  if (config.downloadTokenSecret) return "ambiente";
  const existing = await prisma.appSetting.findUnique({ where: { key: SECRET_KEY } });
  if (existing?.value) {
    persisted = existing.value;
    return "banca dati";
  }
  const created = randomBytes(32).toString("hex");
  // `upsert` e non `create`: due processi che partono insieme non devono
  // litigare sulla chiave primaria.
  const row = await prisma.appSetting.upsert({
    where: { key: SECRET_KEY },
    update: {},
    create: { key: SECRET_KEY, value: created },
  });
  persisted = row.value;
  return "banca dati";
}

export function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Confronto a **tempo costante**, e in **byte**: la lunghezza si misura sui
 * buffer, non sui caratteri. Un `code` con un carattere multibyte ha più byte
 * che caratteri, e `timingSafeEqual` su buffer di lunghezza diversa lancia —
 * ecco perché il confronto delle stringhe non basta a fare da guardia.
 */
export function safeEqual(expected: string, got: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
