// Copyright (c) 2026 Jugaad s.r.l.

import type { ParsedRow } from "./excel";
import { dialettiImport, type RigaLetta, type RuoloRiga, type StatusMeaning } from "./dialects";

/*
 * The import's questions to the dialects, answered once for all of them: the
 * core reads only the KeelOps template, the dialects add the rest.
 */

/** Extra headers of every dialect. */
export const intestazioniDeiDialetti = (): string[] =>
  dialettiImport().flatMap((d) => [...(d.intestazioni ?? [])]);

/** True if some dialect says this row is not data. */
export function rigaDaScartare(riga: RigaLetta): boolean {
  return dialettiImport().some((d) => d.scartaRiga?.(riga) === true);
}

/** A task row with every dialect's columns rewritten in KeelOps terms. */
export function rigaTaskAdattata(row: ParsedRow): ParsedRow {
  return dialettiImport().reduce((r, d) => d.adattaTask?.(r) ?? r, row);
}

/**
 * The part a task row plays. The first dialect with an opinion wins; without
 * one, a row with a title is an activity and the rest is skipped.
 */
export function ruoloRigaTask(row: ParsedRow): RuoloRiga {
  for (const d of dialettiImport()) {
    const ruolo = d.ruoloTask?.(row);
    if (ruolo) return ruolo;
  }
  return (row.values["titolo"] ?? "").trim() ? { tipo: "attivita" } : { tipo: "salta" };
}

/** The meaning of a status name in some dialect, if any. */
export function significatoStato(nome: string): StatusMeaning | undefined {
  const chiave = nome.toLowerCase();
  for (const d of dialettiImport()) {
    const significato = d.aliasStati?.[chiave];
    if (significato) return significato;
  }
  return undefined;
}
