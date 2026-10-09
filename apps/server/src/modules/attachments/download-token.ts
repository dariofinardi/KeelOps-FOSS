import { sign, safeEqual } from "../../lib/signing";

/**
 * Token di download degli allegati, a vita breve e firmati HMAC.
 *
 * Il download non è più diretto per id: prima si passa da una rotta autenticata
 * che verifica i permessi sull'allegato ed emette questo token; solo allora la
 * rotta pubblica di streaming serve il file. Il token porta con sé l'id
 * dell'allegato e una scadenza, così la rotta di streaming non deve rifare i
 * controlli di accesso (il token è già la prova dell'autorizzazione).
 */

const TTL_MS = 5 * 60 * 1000; // 5 minuti: il tempo di far partire il download.

/** Emette un token per scaricare l'allegato indicato (valido pochi minuti). */
export function signDownloadToken(attachmentId: string, now = Date.now()): string {
  const payload = `${attachmentId}.${now + TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** Ritorna l'id dell'allegato se il token è valido e non scaduto, altrimenti null. */
export function verifyDownloadToken(token: string, now = Date.now()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  const got = token.slice(dot + 1);
  if (!safeEqual(sign(payload), got)) return null;

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const attachmentId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || exp < now) return null;
  return attachmentId;
}
