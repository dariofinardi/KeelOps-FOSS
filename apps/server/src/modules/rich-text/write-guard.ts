// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { sanitizeRichText } from "./sanitize";

/**
 * Dove vive del testo scritto dagli utenti che può essere arricchito.
 *
 * La ripulitura non sta nelle rotte: sarebbe una riga da ricordarsi in otto
 * posti — creazione task, modifica task, offerte, progetti, ricorrenze,
 * importazioni — e la prima che si dimentica è quella che passa. Sta sul
 * client Prisma, cioè sull'unica strada che porta al database. Aggiungere un
 * campo qui è una riga; dimenticarsene diventa impossibile.
 */
const RICH_TEXT_FIELDS: Record<string, readonly string[]> = {
  Task: ["description"],
  Project: ["description"],
  RecurrenceTemplate: ["description"],
};

type WriteData = Record<string, unknown>;

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeRichText(value);
  // Prisma accetta anche la forma { set: "..." }.
  if (value && typeof value === "object" && "set" in value) {
    const wrapped = value as { set?: unknown };
    if (typeof wrapped.set === "string") return { ...wrapped, set: sanitizeRichText(wrapped.set) };
  }
  return value;
}

/**
 * Ripulisce i campi arricchiti dei dati in scrittura. Restituisce lo stesso
 * oggetto se non c'era niente da toccare: le scritture sono tante e la
 * stragrande maggioranza non riguarda descrizioni.
 */
export function sanitizeWriteData<T>(model: string, data: T): T {
  const fields = RICH_TEXT_FIELDS[model];
  if (!fields || !data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    let changed = false;
    const rows = data.map((row) => {
      const next = sanitizeWriteData(model, row);
      if (next !== row) changed = true;
      return next;
    });
    return (changed ? rows : data) as T;
  }

  let result: WriteData | null = null;
  for (const field of fields) {
    if (!(field in (data as WriteData))) continue;
    const value = (data as WriteData)[field];
    const clean = sanitizeValue(value);
    if (clean === value) continue;
    result = result ?? { ...(data as WriteData) };
    result[field] = clean;
  }
  return (result ?? data) as T;
}
