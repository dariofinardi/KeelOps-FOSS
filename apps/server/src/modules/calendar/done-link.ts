import { sign, safeEqual } from "../../lib/signing";

/**
 * Il link "Segna come fatto" dentro un evento del calendario.
 *
 * Un calendario sottoscritto è di sola lettura per protocollo: il client non
 * può rimandare indietro niente. Questo link è l'unico modo onesto di chiudere
 * un task dal telefono senza aprire l'applicazione — e resta un link, cioè una
 * cosa che qualunque programma di posta o di calendario sa fare.
 *
 * Due precauzioni che non sono facoltative:
 *
 * 1. **La firma è legata al feed.** Non basta l'id del task: il codice è un
 *    HMAC di `token del feed + id del task`. Così revocare il calendario
 *    spegne anche tutti i link che ne erano usciti — altrimenti un feed
 *    revocato continuerebbe a chiudere task per sempre.
 * 2. **Il link non chiude niente da solo.** Apre una pagina che chiede
 *    conferma, e la chiusura avviene solo con l'invio del modulo. I client di
 *    posta e i motori di anteprima *visitano* i link che trovano: un GET che
 *    chiude un task verrebbe premuto da un programma, non da una persona.
 */
/** Il codice da mettere nell'indirizzo, per quel task e quel feed. */
export function signDoneLink(feedToken: string, taskId: string): string {
  return sign(`done.${feedToken}.${taskId}`);
}

/** Vero se il codice corrisponde: confronto a tempo costante, in byte. */
export function verifyDoneLink(feedToken: string, taskId: string, code: string): boolean {
  return safeEqual(signDoneLink(feedToken, taskId), code);
}
