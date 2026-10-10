// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

// Formattazione valuta basata sulla preferenza dell'utente corrente. Niente stato
// globale mutabile: il codice valuta viene dal CurrentUserContext via useMoney().
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "@/features/auth/useAuth";
import { localeTag } from "@/lib/i18n";

export interface MoneyFormatter {
  format(value: number): string;
}

/**
 * Formatter per un codice valuta ISO; su codice non valido ripiega su EUR. Il
 * raggruppamento e i simboli seguono la lingua (`locale`), l'importo e la valuta
 * restano gli stessi: 1.000 € in italiano, €1,000 in inglese.
 */
export function makeMoneyFormatter(code: string, locale: string = localeTag()): MoneyFormatter {
  const options: Intl.NumberFormatOptions = {
    style: "currency",
    maximumFractionDigits: 0,
    // Alcuni dati CLDR (es. italiano) non raggruppano sotto le cinque cifre: 4540
    // resterebbe "4540 €" mentre 45400 diventa "45.400 €", e due importi vicini
    // si leggerebbero con due convenzioni diverse. "always" forza il separatore
    // delle migliaia anche a quattro cifre.
    useGrouping: "always",
  };
  try {
    return new Intl.NumberFormat(locale, { ...options, currency: code });
  } catch {
    return new Intl.NumberFormat(locale, { ...options, currency: "EUR" });
  }
}

/** Hook: formatter valuta dell'utente corrente, per codice valuta e lingua. */
export function useMoney(): MoneyFormatter {
  const user = useCurrentUser();
  const { i18n } = useTranslation();
  return useMemo(
    () => makeMoneyFormatter(user.currency, localeTag(i18n.language)),
    [user.currency, i18n.language],
  );
}
