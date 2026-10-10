// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../../config";
import { badRequest } from "../../lib/http-errors";

/**
 * Messaggi riservati della chat: chi scrive indirizza il messaggio a
 * **@secret** e il corpo viene cifrato PRIMA di toccare il database — backup,
 * copie e plugin (che leggono SQLite direttamente) vedono solo il cifrato.
 * Chi ha accesso al task lo sblocca riautenticandosi: la cifratura protegge i
 * dati a riposo, il perimetro resta quello del task.
 *
 * AES-256-GCM con chiave derivata (SHA-256) da `SECRET_KEY_CRYPTO` nel `.env`
 * — scelta esplicita dell'utente (26/08/2026): la chiave sta nell'ambiente,
 * non in banca dati, così una copia del database da sola non basta a leggere.
 * Busta: `iv.tag.ciphertext`, i tre pezzi in base64url.
 */

/** Il token nel testo: "@secret" come parola, ovunque nel messaggio. */
const SECRET_TOKEN = /(^|\s)@secret\b[,:]?\s*/i;

export function hasSecretToken(body: string): boolean {
  return SECRET_TOKEN.test(body);
}

/** Via il token: nel contenuto cifrato non serve, e sbloccato non deve ricomparire. */
export function stripSecretToken(body: string): string {
  return body.replace(SECRET_TOKEN, "$1").trim();
}

function key(): Buffer {
  if (!config.secretKeyCrypto) {
    throw badRequest(
      "I messaggi riservati non sono configurati: manca SECRET_KEY_CRYPTO nell'ambiente del server",
    );
  }
  return createHash("sha256").update(config.secretKeyCrypto).digest();
}

export function encryptSecretBody(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecretBody(envelope: string): string {
  const [iv, tag, data] = envelope.split(".").map((part) => Buffer.from(part ?? "", "base64url"));
  if (!iv?.length || !tag?.length || !data) {
    throw badRequest("Messaggio riservato illeggibile: busta non valida");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
