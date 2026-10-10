// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/**
 * **La coda dei lavori del modello locale.**
 *
 * Nasce per le note di rilascio (19/08/2026) e da oggi ospita anche la lettura
 * degli allegati di un'offerta vinta: sono due lavori diversi ma con lo stesso
 * problema, e quel problema è la coda — Ollama serve **una richiesta per
 * volta**, quindi due persone che chiedono insieme non ottengono due risposte
 * in parallelo, ma due risposte lente senza sapere a che punto sono.
 *
 * Il pannello è quindi uno solo. Le righe portano un `kind` e due testi già
 * pronti (`title`, `subtitle`): la coda non deve sapere cosa sia una nota di
 * rilascio né cosa sia un'offerta — lo sa chi mette in fila.
 */
export const LLM_JOB_STATES = [
  "queue",
  "running",
  "generating",
  "removing",
  "done",
  "failed",
  "cancelled",
] as const;
export type LlmJobState = (typeof LLM_JOB_STATES)[number];

/** Che lavoro è. Serve all'icona e alla riga: il resto è già testo. */
export const LLM_JOB_KINDS = ["release-note", "deal-analysis", "newsletter"] as const;
export type LlmJobKind = (typeof LLM_JOB_KINDS)[number];

export const llmJobSchema = z.object({
  id: z.string(),
  kind: z.enum(LLM_JOB_KINDS),
  state: z.enum(LLM_JOB_STATES),
  userId: z.string(),
  userName: z.string(),
  /** Di cosa parla: il progetto, o l'offerta. */
  title: z.string(),
  /** La riga sotto: la settimana chiesta, o quanti allegati ci sono da leggere. */
  subtitle: z.string(),
  /** Dove porta la riga quando il lavoro è finito (`null` se non porta da nessuna parte). */
  href: z.string().nullable(),
  requestedAt: z.string(),
});
export type LlmJob = z.infer<typeof llmJobSchema>;
