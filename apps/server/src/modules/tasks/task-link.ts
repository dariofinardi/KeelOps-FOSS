import { taskRecordUrl } from "../mail/notification-mail";

/**
 * **Il link interno a un task** (06/10/2026): l'indirizzo con cui un record
 * rimanda a un task di questa stessa istanza — oggi l'allegato «Task di origine»
 * di un'offerta creata da un task. Si apre nel pannello, sopra il record da cui
 * si viene, e non in una scheda nuova.
 *
 * L'indirizzo è quello generico di ogni task (`/bacheche?task=<id>`, vedi
 * `taskRecordUrl`): apre sia gli amministrativi sia i task di progetto e quelli
 * nati da un ticket. Riconosciuto **solo** se è di questa istanza e ha quella
 * forma: ogni altro link resta quello che è (sito esterno, documento Google).
 */
export function taskLinkUrl(base: string, taskId: string): string {
  return taskRecordUrl(base.replace(/\/+$/, ""), taskId, null);
}

/** L'id del task a cui punta un link di questa istanza, o null se non è un link a un task. */
export function taskIdFromLink(url: string, base: string): string | null {
  if (!base) return null;
  let link: URL;
  let casa: URL;
  try {
    link = new URL(url);
    casa = new URL(base);
  } catch {
    return null;
  }
  if (link.origin !== casa.origin) return null;
  const radice = casa.pathname.replace(/\/+$/, "");
  if (link.pathname.replace(/\/+$/, "") !== `${radice}/bacheche`) return null;
  const id = link.searchParams.get("task");
  return id && /^[a-z0-9]{10,40}$/i.test(id) ? id : null;
}
