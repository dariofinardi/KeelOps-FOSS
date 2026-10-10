// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { moduliAttivi, type ModuloEdizione } from "../../edition/registry";
import type { ParsedRow } from "./excel";

/**
 * **Spreadsheet dialects for the Excel import** (08/10/2026).
 *
 * The core import reads the KeelOps template only. A dialect — the export of
 * another tool — is brought by an edition module (in the commercial edition,
 * Monday: see commercial/migrazioni/monday-excel.ts) and teaches the import
 * its columns, the rows to skip, its sub-items and its status names. The
 * community edition has no dialect: migrating from other platforms is a
 * professional service.
 */

/** What a status name means, whatever the installation calls its statuses. */
export type StatusMeaning = "initial" | "closed" | "stopsRecurrence";

/** A row as the sheet reader sees it, before it becomes data. */
export interface RigaLetta {
  values: Record<string, string>;
  filledCount: number;
  /** Recognised headers in the header row. */
  bestMatches: number;
  isKnownHeader: (text: string) => boolean;
}

/** The part a task row plays in the sheet. */
export type RuoloRiga =
  { tipo: "attivita" } | { tipo: "sotto"; titolo: string } | { tipo: "salta" };

export interface DialettoImport {
  nome: string;
  /** Extra headers that help finding the header row. */
  intestazioni?: readonly string[];
  /** A row that is not data (group rows, repeated headers). */
  scartaRiga?: (riga: RigaLetta) => boolean;
  /** Task rows: the dialect's columns rewritten with the KeelOps names. */
  adattaTask?: (row: ParsedRow) => ParsedRow;
  /** Task rows: activity, sub-item of the previous activity, or skip; null = no opinion. */
  ruoloTask?: (row: ParsedRow) => RuoloRiga | null;
  /** Status names of the dialect, by meaning (lowercase keys). */
  aliasStati?: Readonly<Record<string, StatusMeaning>>;
}

/** The dialects of the active modules. */
export function dialettiImport(
  moduli: readonly ModuloEdizione[] = moduliAttivi(),
): readonly DialettoImport[] {
  return moduli.flatMap((modulo) => modulo.dialettiImport ?? []);
}
