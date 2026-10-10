// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyRequest } from "fastify";
import type { User } from "../generated/prisma/client";
import it from "./catalogs/it.json";
import en from "./catalogs/en.json";
import fr from "./catalogs/fr.json";
import de from "./catalogs/de.json";
import es from "./catalogs/es.json";
import pt from "./catalogs/pt.json";

/**
 * Traduzione dei testi che il SERVER manda all'utente — messaggi d'errore,
 * notifiche, email. Stessa idea del web: **l'italiano è la chiave**, i cataloghi
 * per lingua traducono, e ciò che non è tradotto ricade sull'italiano.
 *
 * A differenza del web questi cataloghi contengono SOLO le stringhe del server
 * (le ~130 dei messaggi d'errore, i modelli delle notifiche, le etichette delle
 * email): non c'entrano con quelli dell'interfaccia.
 */
const CATALOGS: Record<string, Record<string, string>> = { it, en, fr, de, es, pt };
/**
 * Le lingue che il server sa parlare. Esportata perché serve anche a chi deve
 * **riconoscere** un testo generato in una qualunque di esse, non solo a
 * produrne uno: il suffisso "(copia n)" di un task può essere stato scritto da
 * un collega con l'interfaccia in un'altra lingua.
 */
export const SERVER_LOCALES = ["it", "en", "fr", "de", "es", "pt"] as const;
const SUPPORTED: readonly string[] = SERVER_LOCALES;
/** Il default del prodotto quando la lingua non si sa: inglese. */
const DEFAULT_LOCALE = "en";

/** Una preferenza (anche "auto"/assente) risolta in una lingua concreta. */
export function resolveServerLocale(locale: string | null | undefined): string {
  return locale && SUPPORTED.includes(locale) ? locale : DEFAULT_LOCALE;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] != null ? String(params[key]) : `{{${key}}}`,
  );
}

/**
 * Traduce una chiave (frase italiana) nella lingua data, interpolando `{{var}}`.
 * Con `count` sceglie la forma plurale (`_one`/`_other`) secondo le regole della
 * lingua; le forme vivono in ogni catalogo, italiano compreso.
 */
export function serverT(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const loc = resolveServerLocale(locale);
  let lookupKey = key;
  if (params && typeof params.count === "number") {
    const rule = new Intl.PluralRules(loc).select(params.count);
    lookupKey = `${key}_${rule}`;
  }
  const value =
    CATALOGS[loc]?.[lookupKey] ??
    // Plurali: se manca nella lingua, l'italiano ha comunque le forme _one/_other.
    (lookupKey !== key ? CATALOGS.it?.[lookupKey] : undefined) ??
    key;
  return interpolate(value, params);
}

/** La lingua di un utente (destinatario di notifiche/email): concreta o inglese. */
export function localeOfUser(user: { locale: string | null } | null | undefined): string {
  return resolveServerLocale(user?.locale ?? null);
}

/**
 * La lingua di CHI FA la richiesta, per i messaggi d'errore. Vince l'header
 * `X-Locale` che il client manda con la sua lingua attiva (utile quando la
 * preferenza salvata è "auto" e la vera lingua la sa solo il browser);
 * altrimenti la preferenza dell'utente, altrimenti inglese.
 */
export function localeFromRequest(request: FastifyRequest): string {
  const header = String(request.headers["x-locale"] ?? "");
  if (SUPPORTED.includes(header)) return header;
  const user = (request as FastifyRequest & { currentUser?: User | null }).currentUser;
  return resolveServerLocale(user?.locale ?? null);
}
