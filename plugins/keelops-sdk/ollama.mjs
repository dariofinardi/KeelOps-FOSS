/**
 * The plugins' one door to Ollama.
 *
 * The core lends `ctx.ollamaUrl` and nothing else; a plugin that wants
 * embeddings or a local model answer goes through here, never through its
 * own `fetch`. Two plugins had each written the same forty lines (batches,
 * timeout, the 503 that becomes "no vectors"), with small unintended
 * differences — the day one needed a retry the other would not have had it.
 *
 * The rules, the same the core follows in `lib/ollama.ts`:
 *  - **a failure is `null`**, never an exception: Ollama off, model missing,
 *    time out — the caller always has a plan B (tf-idf, no answer), and a
 *    local model must never take a request down with it;
 *  - `/api/chat`, never `/api/generate`: today's instruct models answer only
 *    there (measured 21/08/2026);
 *  - temperature zero: the same question gives the same answer.
 */

export const EMBEDDING_MODEL = "bge-m3";

const base = (url) => String(url ?? "").replace(/\/$/, "");

/** In-place-free L2 normalisation: cosine similarity becomes a dot product. */
export function normalize(vector) {
  let n = 0;
  for (const x of vector) n += x * x;
  n = Math.sqrt(n) || 1;
  return vector.map((x) => x / n);
}

/** Dot product of two vectors of the same length (cosine, once normalised). */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * Embeddings for `input` (an array of strings), in batches, normalised
 * unless asked otherwise. `onProgress(done, total)` after each batch.
 * Returns `null` on any failure, so the caller falls back in one line.
 */
export async function embed({ url, input, model = EMBEDDING_MODEL, batch = 64, timeoutMs = 120_000, normalized = true, onProgress }) {
  const root = base(url);
  if (!root || !Array.isArray(input)) return null;
  if (input.length === 0) return [];
  const out = [];
  try {
    for (let i = 0; i < input.length; i += batch) {
      const res = await fetch(`${root}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: input.slice(i, i + batch) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const vectors = (await res.json()).embeddings;
      if (!Array.isArray(vectors)) return null;
      out.push(...(normalized ? vectors.map(normalize) : vectors));
      onProgress?.(Math.min(i + batch, input.length), input.length);
    }
  } catch {
    return null;
  }
  return out.length === input.length ? out : null;
}

/**
 * One answer from a local model: `system` + `user`, optional JSON `schema`
 * for the `format` field, `think` off by default. The text, or `null`.
 */
export async function chat({ url, model, system, user, schema, think = false, numPredict = 512, numCtx, keepAlive, timeoutMs = 60_000 }) {
  const root = base(url);
  if (!root || !model) return null;
  try {
    const res = await fetch(`${root}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think,
        ...(schema ? { format: schema } : {}),
        ...(keepAlive ? { keep_alive: keepAlive } : {}),
        options: { temperature: 0, num_predict: numPredict, ...(numCtx ? { num_ctx: numCtx } : {}) },
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: String(user ?? "") },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const content = (await res.json())?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}
