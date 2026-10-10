// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import type { LlmJob, LlmJobState } from "@kancrm/shared";

/**
 * **La coda dei lavori del modello locale.**
 *
 * Nata per le note di rilascio, dal 21/08/2026 ospita anche la lettura degli
 * allegati di un'offerta vinta. La coda non sa cosa siano: riceve due testi già
 * pronti e una funzione da eseguire. Chi mette in fila sa di cosa parla.
 *
 * Perché esiste, detto con precisione: generare una nota **non blocca il
 * server** — misurato, 142 risposte servite durante una generazione da 37
 * secondi, mediana 5ms — perché quel tempo è attesa di rete su Ollama, che
 * libera il ciclo di eventi. Il problema è un altro: **Ollama serve una
 * richiesta per volta**, quindi cinque persone che chiedono insieme non
 * ottengono cinque note in parallelo, ma cinque note tutte lente, senza che
 * nessuno sappia a che punto è la propria né possa fermarla.
 *
 * Da cui: **una alla volta** (`CONCURRENCY`), in fila, visibile e fermabile.
 * Aumentare la concorrenza qui non accorcerebbe niente — le richieste si
 * metterebbero in coda dentro Ollama invece che qui, dove almeno si vedono.
 *
 * La coda vive **in memoria**. Un riavvio la perde: chi aspettava non riceve
 * niente. È la stessa scelta già fatta per il lavoro asincrono — una coda
 * persistente per documenti che si rigenerano in un minuto è più macchinario di
 * quanto il problema meriti — ma ora almeno si vede, invece di essere un
 * silenzio.
 */

/** Quante generazioni insieme. Uno: vedi la nota qui sopra. */
const CONCURRENCY = 1;

/** Quante ne restano in elenco dopo la fine, per capire cos'è successo. */
const KEEP_FINISHED = 20;

interface Entry extends LlmJob {
  run: (signal: AbortSignal, onGenerating: () => void) => Promise<void>;
  controller: AbortController | null;
}

const entries = new Map<string, Entry>();
let running = 0;

/** L'elenco per il pannello: prima ciò che è in corso, poi la fila, poi i finiti. */
export function listJobs(filter?: { userId?: string }): LlmJob[] {
  const ordine: Record<LlmJobState, number> = {
    generating: 0,
    running: 0,
    removing: 1,
    queue: 2,
    done: 3,
    failed: 3,
    cancelled: 3,
  };
  return [...entries.values()]
    .filter((entry) => !filter?.userId || entry.userId === filter.userId)
    .map(toDto)
    .sort(
      (a, b) =>
        ordine[a.state] - ordine[b.state] || Date.parse(a.requestedAt) - Date.parse(b.requestedAt),
    );
}

function toDto(entry: Entry): LlmJob {
  const { id, kind, state, userId, userName, title, subtitle, href, requestedAt } = entry;
  return { id, kind, state, userId, userName, title, subtitle, href, requestedAt };
}

/** Mette in fila e fa partire il giro, se c'è posto. */
export function enqueue(
  job: Omit<LlmJob, "id" | "state" | "requestedAt">,
  run: Entry["run"],
): LlmJob {
  const entry: Entry = {
    ...job,
    id: randomUUID(),
    state: "queue",
    requestedAt: new Date().toISOString(),
    run,
    controller: null,
  };
  entries.set(entry.id, entry);
  void pump();
  return toDto(entry);
}

/**
 * Toglie un lavoro. In fila sparisce subito; in esecuzione passa per
 * `removing` — il segnale arriva alla richiesta in volo e il ciclo si ferma al
 * task successivo, quindi qualche secondo c'è. Dirlo con uno stato invece di
 * far finta che sia immediato è la differenza fra un pulsante che funziona e
 * uno che sembra rotto.
 *
 * `false` se quel lavoro non c'è o non è di chi lo chiede.
 */
export function cancelJob(id: string, options: { userId: string; isAdmin: boolean }): boolean {
  const entry = entries.get(id);
  if (!entry) return false;
  if (!options.isAdmin && entry.userId !== options.userId) return false;

  if (entry.state === "queue") {
    entries.delete(id);
    return true;
  }
  if (entry.state === "running" || entry.state === "generating") {
    entry.state = "removing";
    entry.controller?.abort();
    return true;
  }
  // Già finito: toglierlo dall'elenco è comunque un gesto sensato.
  entries.delete(id);
  return true;
}

/** Fa partire quello che si può far partire. */
async function pump(): Promise<void> {
  if (running >= CONCURRENCY) return;
  const next = [...entries.values()].find((entry) => entry.state === "queue");
  if (!next) return;

  running += 1;
  next.state = "running";
  next.controller = new AbortController();
  try {
    await next.run(next.controller.signal, () => {
      // Il modello ha cominciato a lavorare: da qui in poi è la parte lunga.
      if (next.state === "running") next.state = "generating";
    });
    next.state = next.controller.signal.aborted ? "cancelled" : "done";
  } catch {
    next.state = next.controller.signal.aborted ? "cancelled" : "failed";
  } finally {
    running -= 1;
    next.controller = null;
    prune();
    void pump();
  }
}

/** Tiene in elenco solo gli ultimi finiti: la coda non è un archivio. */
function prune(): void {
  const finiti = [...entries.values()]
    .filter(
      (entry) => entry.state === "done" || entry.state === "failed" || entry.state === "cancelled",
    )
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  for (const entry of finiti.slice(KEEP_FINISHED)) entries.delete(entry.id);
}

/** Solo per i test: svuota tutto. */
export function resetQueue(): void {
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  running = 0;
}
