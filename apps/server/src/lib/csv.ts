// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cella CSV sicura: raddoppia le virgolette e racchiude tra virgolette, MA
 * antepone anche un apostrofo ai valori che iniziano con `= + - @` (o TAB/CR).
 * Senza, un task intitolato `=HYPERLINK("http://evil")` diventa una formula
 * attiva quando l'export viene aperto in Excel/Sheets (CSV injection).
 */
export function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const safe = risky ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
