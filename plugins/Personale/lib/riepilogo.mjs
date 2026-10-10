// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plugin's line in the core's morning digest (contract: `riepilogoMattutino`
 * in what `create()` returns, see plugins/README.md). The core asks once a
 * day, for everyone; the plugin answers with the people who have personal
 * cards overdue or due today/tomorrow, and a function that writes the line in
 * a given locale — the core knows each recipient's language, the plugin does
 * not, and the sentence must read like the rest of the email.
 */
import { scadenzePerUtente, todayISO } from "./tasks.mjs";

const FRASI = {
  it: { intro: "Bacheche personali", overdue: "{n} in ritardo", today: "{n} in scadenza oggi", tomorrow: "{n} in scadenza domani" },
  en: { intro: "Personal boards", overdue: "{n} overdue", today: "{n} due today", tomorrow: "{n} due tomorrow" },
  fr: { intro: "Tableaux personnels", overdue: "{n} en retard", today: "{n} à échéance aujourd'hui", tomorrow: "{n} à échéance demain" },
  de: { intro: "Persönliche Boards", overdue: "{n} überfällig", today: "{n} heute fällig", tomorrow: "{n} morgen fällig" },
  es: { intro: "Tableros personales", overdue: "{n} atrasadas", today: "{n} vencen hoy", tomorrow: "{n} vencen mañana" },
  pt: { intro: "Quadros pessoais", overdue: "{n} em atraso", today: "{n} com prazo hoje", tomorrow: "{n} com prazo amanhã" },
};

/** The sentence for one person's counts, in `locale` (unknown → English). */
export function frase(counts, locale) {
  const f = FRASI[String(locale ?? "").slice(0, 2).toLowerCase()] ?? FRASI.en;
  const parts = ["overdue", "today", "tomorrow"]
    .filter((k) => counts[k] > 0)
    .map((k) => f[k].replace("{n}", String(counts[k])));
  return parts.length ? `${f.intro}: ${parts.join(", ")}.` : "";
}

/** What the core calls: `[{ userId, righe(locale) => string[] }]` for today. */
export async function riepilogoMattutino(db, { oggi } = {}) {
  const today = oggi ?? todayISO();
  const out = [];
  for (const [userId, counts] of await scadenzePerUtente(db, today)) {
    out.push({ userId, righe: (locale) => [frase(counts, locale)].filter(Boolean) });
  }
  return out;
}
