// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { isExternalRole } from "@kancrm/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * **Quali messaggi della chat vede chi sta fuori.**
 *
 * Gli interni vedono tutto. I clienti del portale e i monitor vendite no
 * (16/09/2026):
 *
 * - un messaggio `@reserved` è **riservato agli interni**: è scritto per i
 *   colleghi, e al cliente non esiste;
 * - un messaggio `@secret` è **cifrato**, e al cliente non esiste nemmeno
 *   lui. Chi sta fuori `@secret` non lo scrive (16/09/2026: verificato in
 *   produzione, nessun cliente né monitor ne aveva mai scritto uno), quindi
 *   non c'è il caso del «proprio» cifrato da lasciargli vedere.
 *
 * «Non esiste» vuol dire **in ogni posto** in cui un messaggio si lascia
 * intravedere: l'elenco della chat, il numero accanto al fumetto, il
 * segnalino «non letto», i nomi citabili, la ricerca, gli allegati arrivati
 * con lui e le notifiche. Una regola scritta in sette posti diverge al primo
 * ritocco: sta qui, e i sette posti la chiedono.
 */

interface Chi {
  id: string;
  role: string;
}

interface Messaggio {
  authorId: string;
  secret: boolean;
  reserved: boolean;
}

/** Chi guarda sta fuori dall'azienda: cliente del portale o monitor vendite. */
export function staFuori(user: Pick<Chi, "role">): boolean {
  return isExternalRole(user.role);
}

/**
 * Il filtro Prisma dei messaggi che `user` può vedere. Per un interno è vuoto.
 * Chi lo usa lo mette comunque **dentro un `AND`**: è la forma che non si
 * rompe il giorno in cui la regola torna ad avere un `OR`.
 */
export function messaggiVisibiliA(user: Chi): Prisma.CommentWhereInput {
  if (!staFuori(user)) return {};
  return { reserved: false, secret: false };
}

/**
 * `@secret` lo scrivono solo gli interni. Dal portale e dal monitor vendite è
 * una parola del messaggio: il cliente non può mandare un testo che nemmeno
 * lui, dopo, potrebbe rileggere (16/09/2026).
 */
export function puoCifrare(user: Pick<Chi, "role">): boolean {
  return !staFuori(user);
}

/** Lo stesso, per un messaggio già letto dal database. */
export function messaggioVisibileA(user: Chi, messaggio: Messaggio): boolean {
  if (!staFuori(user)) return true;
  return !messaggio.reserved && !messaggio.secret;
}

/**
 * Il messaggio è nascosto a **tutti** quelli fuori: serve a decidere chi
 * avvisare mentre lo si salva. Un avviso che porta il cliente a una chat in
 * cui il messaggio non c'è sarebbe un avviso falso.
 */
export function nascostoAChiStaFuori(messaggio: Pick<Messaggio, "secret" | "reserved">): boolean {
  return messaggio.secret || messaggio.reserved;
}
