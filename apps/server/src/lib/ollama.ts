// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { config } from "../config";

/**
 * **L'unica porta verso Ollama.**
 *
 * Tre moduli parlano con un modello locale — la lettura delle offerte,
 * l'indicizzazione semantica, il micromodello delle assenze — e ognuno si era
 * scritto la sua copia della stessa chiamata: timeout con `AbortController`,
 * `think`, lo schema JSON, il guasto che diventa `null`. Tre copie di
 * quaranta righe con differenze piccole ma volute (la scheda, il keep-alive)
 * e tutto il resto identico: il giorno del retry sul 503 si sarebbe corretto
 * un modulo su tre.
 *
 * Le scelte fisse, imparate sul campo e valide per tutti:
 *  - **`/api/chat`, mai `/api/generate`**: i modelli instruct di oggi
 *    rispondono solo lì (con qwen3.8 la stessa domanda su generate torna
 *    vuota — misurato il 21/08/2026);
 *  - **temperatura zero**: stessa domanda, stessa risposta — un indice che
 *    cambia da solo a ogni ricostruzione non è un indice;
 *  - **un guasto è `null`**, non un'eccezione: Ollama spento, modello
 *    assente, tempo scaduto — chi chiama ha sempre un piano B, e un modello
 *    locale non deve mai far cadere una richiesta.
 */
export interface OllamaChatRequest {
  /** Vuoto = l'istanza dei modelli grandi (`OLLAMA_URL`). */
  url?: string;
  model: string;
  system: string;
  user: string;
  /** Schema JSON per `format`: vincola la risposta alla forma attesa. */
  schema?: object;
  /** I modelli pensanti consumano nel ragionamento i token della risposta. */
  think?: boolean;
  numPredict: number;
  numCtx?: number;
  /** `0` = sempre CPU: il micromodello non deve toccare la VRAM. */
  numGpu?: number;
  keepAlive?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Il testo della risposta, o `null` per qualunque guasto. */
export async function ollamaChat(richiesta: OllamaChatRequest): Promise<string | null> {
  const base = (richiesta.url || config.ollamaUrl).replace(/\/$/, "");
  if (base === "" || richiesta.model === "") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), richiesta.timeoutMs);
  const stop = () => controller.abort();
  richiesta.signal?.addEventListener("abort", stop, { once: true });
  try {
    const risposta = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: richiesta.model,
        stream: false,
        think: richiesta.think ?? false,
        ...(richiesta.schema ? { format: richiesta.schema } : {}),
        ...(richiesta.keepAlive ? { keep_alive: richiesta.keepAlive } : {}),
        options: {
          temperature: 0,
          num_predict: richiesta.numPredict,
          ...(richiesta.numCtx !== undefined ? { num_ctx: richiesta.numCtx } : {}),
          ...(richiesta.numGpu !== undefined ? { num_gpu: richiesta.numGpu } : {}),
        },
        messages: [
          { role: "system", content: richiesta.system },
          { role: "user", content: richiesta.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!risposta.ok) return null;
    const corpo = (await risposta.json()) as { message?: { content?: string } };
    return corpo.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    richiesta.signal?.removeEventListener("abort", stop);
  }
}

/** Lo stato di un modello sull'istanza: c'è, è caricato, e dove. */
export interface OllamaModelStatus {
  /** L'istanza risponde. */
  raggiungibile: boolean;
  /** Il modello è installato (in `/api/tags`). */
  presente: boolean;
  /** È in memoria adesso (in `/api/ps`). */
  caricato: boolean;
  /** Byte in VRAM e dimensione totale: il rapporto dice DOVE sta girando. */
  inVram: number;
  dimensione: number;
}

async function leggiJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const risposta = await fetch(url, { signal: controller.signal });
    return risposta.ok ? await risposta.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** I nomi di Ollama: «assenze» e «assenze:latest» sono lo stesso modello. */
function stessoModello(a: string, b: string): boolean {
  const pulisci = (nome: string) => (nome.endsWith(":latest") ? nome.slice(0, -7) : nome);
  return pulisci(a) === pulisci(b);
}

/**
 * **Prima di un lavoro lungo si controlla che ci sia qualcuno dall'altra parte.**
 *
 * Senza questo, un'istanza spenta o un modello disinstallato producevano una
 * lettura vuota consegnata come buona — e un modello finito in RAM (perché al
 * momento del caricamento la scheda era occupata) lavorava a dieci volte il
 * tempo senza che nessuno lo dicesse: 486 secondi per un'offerta, visti il
 * 21/08/2026 con la 3090 libera e il modello altrove.
 */
export async function ollamaModelStatus(opzioni: {
  url?: string;
  model: string;
  timeoutMs?: number;
}): Promise<OllamaModelStatus> {
  const base = (opzioni.url || config.ollamaUrl).replace(/\/$/, "");
  const timeoutMs = opzioni.timeoutMs ?? 5_000;
  const niente: OllamaModelStatus = {
    raggiungibile: false,
    presente: false,
    caricato: false,
    inVram: 0,
    dimensione: 0,
  };
  if (base === "" || opzioni.model === "") return niente;

  const tags = (await leggiJson(`${base}/api/tags`, timeoutMs)) as {
    models?: Array<{ name: string }>;
  } | null;
  if (!tags) return niente;
  const presente = (tags.models ?? []).some((m) => stessoModello(m.name, opzioni.model));
  if (!presente) return { ...niente, raggiungibile: true };

  const ps = (await leggiJson(`${base}/api/ps`, timeoutMs)) as {
    models?: Array<{ name: string; size?: number; size_vram?: number }>;
  } | null;
  const caricato = (ps?.models ?? []).find((m) => stessoModello(m.name, opzioni.model));
  return {
    raggiungibile: true,
    presente: true,
    caricato: caricato !== undefined,
    inVram: caricato?.size_vram ?? 0,
    dimensione: caricato?.size ?? 0,
  };
}

/**
 * Carica il modello adesso (una generazione da un token), così il lavoro vero
 * non paga il caricamento e — se una scheda nel frattempo si è liberata — il
 * modello ci finisce sopra invece di restare in RAM. Torna lo stato DOPO il
 * caricamento, che è quello che conta: `inVram/dimensione` dice dove girerà.
 */
export async function ollamaWarmup(opzioni: {
  url?: string;
  model: string;
  keepAlive?: string;
  timeoutMs: number;
}): Promise<OllamaModelStatus> {
  await ollamaChat({
    url: opzioni.url,
    model: opzioni.model,
    system: "",
    user: "ok",
    numPredict: 1,
    keepAlive: opzioni.keepAlive,
    timeoutMs: opzioni.timeoutMs,
  });
  return ollamaModelStatus({ url: opzioni.url, model: opzioni.model });
}

/**
 * Scarica il modello dalla memoria (keep_alive 0). Serve a un caso preciso: il
 * modello è rimasto **in RAM** perché al caricamento la scheda era piena, la
 * scheda ora è libera, e Ollama da solo non lo sposta mai — scaricare e
 * ricaricare è l'unico modo di dargli la memoria giusta.
 */
export async function ollamaUnload(opzioni: {
  url?: string;
  model: string;
  timeoutMs?: number;
}): Promise<void> {
  const base = (opzioni.url || config.ollamaUrl).replace(/\/$/, "");
  if (base === "" || opzioni.model === "") return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opzioni.timeoutMs ?? 10_000);
  try {
    await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opzioni.model, messages: [], keep_alive: 0 }),
      signal: controller.signal,
    });
  } catch {
    // Se non si riesce a scaricarlo, si lavora com'è: peggio di così non va.
  } finally {
    clearTimeout(timer);
  }
}
