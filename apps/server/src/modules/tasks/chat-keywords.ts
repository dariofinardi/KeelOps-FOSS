/**
 * **Le parole chiave della chat**: comandi che si scrivono nel messaggio e che
 * non fanno parte del messaggio.
 *
 * Oggi sono due, e nascono dalla stessa esigenza — dire qualcosa *sul* messaggio
 * mentre lo si scrive, senza un pannello di opzioni accanto al campo:
 *
 * - `@secret` cifra il testo (vedi `secret-comments.ts`, che se ne occupa da sé
 *   perché ha anche le chiavi);
 * - `@user` manda il messaggio **al cliente che ha aperto la richiesta**, per
 *   email.
 *
 * Il perché di `@user` è tutto nel secondo effetto: senza, il cliente riceveva
 * un'email a ogni messaggio interno sul suo ticket — commenti fra colleghi
 * compresi — e la casella si riempiva di cose che non lo riguardavano. Adesso
 * il cliente sente **i cambi di stato**, che sono la notizia che aspetta, e
 * **i messaggi che qualcuno ha deciso di mandargli** (02/09/2026).
 *
 * Il token si toglie dal testo salvato: è un comando per noi, non una parola
 * per chi legge.
 */

/**
 * `@reserved` (16/09/2026) tiene il messaggio **fra colleghi**: resta in
 * chiaro, ma i clienti del portale e i monitor vendite non lo vedono. Lo
 * scrivono solo gli interni: dal portale è una parola come un'altra, perché
 * un cliente che nasconde il proprio messaggio a sé stesso non ha senso.
 * Cosa vuol dire «non lo vedono» sta in `comment-visibility.ts`.
 */
const RESERVED_TOKEN = /(^|\s)@reserved\b[,:]?\s*/i;

export function hasReservedToken(body: string): boolean {
  return RESERVED_TOKEN.test(body);
}

export function stripReservedToken(body: string): string {
  return body.replace(RESERVED_TOKEN, "$1").trim();
}

/** Il token nel testo: "@user" come parola, ovunque nel messaggio. */
const USER_TOKEN = /(^|\s)@user\b[,:]?\s*/i;

export function hasUserToken(body: string): boolean {
  return USER_TOKEN.test(body);
}

export function stripUserToken(body: string): string {
  return body.replace(USER_TOKEN, "$1").trim();
}

/**
 * L'inizio del messaggio, per l'avviso: quanto basta a capire di cosa si parla
 * senza travasare l'intera conversazione dentro una notifica — che finisce
 * anche in un'email e in una notifica push, dove lo spazio è quello che è.
 */
export function anteprima(testo: string, massimo = 180): string {
  const pulito = testo
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return pulito.length <= massimo ? pulito : `${pulito.slice(0, massimo - 1).trimEnd()}…`;
}
