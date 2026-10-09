/**
 * The vectors of the tasks, one per task, kept in `plugin_tasksmap_vettore`.
 *
 * A vector depends only on the task's own text and on the model, so it can
 * be shared by everyone who sees the task and survives until the text
 * changes: the fingerprint says when. What cannot be cached is tf-idf — its
 * vocabulary is the corpus, i.e. the set of tasks in front of one user — so
 * when Ollama is not there the vectors are computed on the spot, every time,
 * and nothing is written.
 */
import { createHash } from "node:crypto";
import { embed, EMBEDDING_MODEL } from "../../keelops-sdk/ollama.mjs";
import { tfidfEmbeddings } from "./graph.mjs";

export const textOf = (task) => `${task.title}. ${task.text.slice(0, 200)}`;
export const fingerprint = (text, model) => createHash("sha256").update(`${model}\n${text}`).digest("hex");

/**
 * The vectors of `tasks`, in their order, plus the source: `bge-m3` when
 * every vector came from (or was already in) the store, `tf-idf` otherwise.
 * `onProgress(done, total)` counts the embeddings actually computed.
 * Writing is best effort: a driver that cannot write (a read-only standalone
 * run) just means computing again next time.
 */
export async function vectorsFor(db, tasks, ollamaUrl, onProgress) {
  const texts = tasks.map(textOf);
  if (!ollamaUrl || tasks.length === 0) return { vectors: tfidfEmbeddings(texts), source: "tf-idf" };

  const prints = texts.map((t) => fingerprint(t, EMBEDDING_MODEL));
  const stored = new Map();
  for (let i = 0; i < tasks.length; i += 200) {
    const slice = tasks.slice(i, i + 200);
    const rows = await db.all(
      `SELECT taskId, impronta, vettore FROM plugin_tasksmap_vettore WHERE modello = ? AND taskId IN (${slice.map(() => "?").join(",")})`,
      EMBEDDING_MODEL, ...slice.map((t) => t.id));
    for (const r of rows) stored.set(r.taskId, r);
  }
  const vectors = new Array(tasks.length).fill(null);
  const missing = [];
  tasks.forEach((t, i) => {
    const row = stored.get(t.id);
    if (row && row.impronta === prints[i]) {
      try { vectors[i] = JSON.parse(row.vettore); return; } catch { /* a corrupt row is a missing row */ }
    }
    missing.push(i);
  });
  onProgress?.(0, missing.length);
  if (missing.length > 0) {
    const fresh = await embed({ url: ollamaUrl, input: missing.map((i) => texts[i]), onProgress });
    if (!fresh) return { vectors: tfidfEmbeddings(texts), source: "tf-idf" };
    const now = new Date().toISOString();
    for (const [k, i] of missing.entries()) {
      vectors[i] = fresh[k];
      try {
        await db.run(
          `INSERT INTO plugin_tasksmap_vettore (taskId, impronta, modello, vettore, calcolatoIl) VALUES (?, ?, ?, ?, ?) ` +
            db.sql.upsert("taskId", ["impronta", "modello", "vettore", "calcolatoIl"]),
          tasks[i].id, prints[i], EMBEDDING_MODEL, JSON.stringify(fresh[k].map((x) => Math.round(x * 1e6) / 1e6)), now);
      } catch { /* cannot write here (standalone, read-only copy): compute again next time */ }
    }
  }
  return { vectors, source: EMBEDDING_MODEL };
}
