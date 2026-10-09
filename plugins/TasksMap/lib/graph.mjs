/**
 * The map graph: text themes, hierarchy edges, variable time windows, co-work
 * and parenthood suggestions.
 *
 * Every choice comes from measurements (plan/misure-modelli.md and the plugin
 * study, 22/08/2026):
 *  - themes = mutual 3-NN over embeddings + label propagation (stable,
 *    deterministic); bge-m3 via Ollama when available, tf-idf otherwise;
 *  - time edges use VARIABLE windows (1/7/14/28 days) and also require some
 *    text similarity: dates alone are wrong 94 times out of 100 (measured);
 *  - parenthood suggestions rank by creation proximity (AUC 0.85-0.94) plus
 *    life overlap plus text, the arrow given by birth order.
 */

import { normalize, dot } from "../../keelops-sdk/ollama.mjs";

const STOPWORDS = new Set(("di del della dei il lo la i gli le un uno una e o a da in per con su che è non al alla " +
  "the of and to for on with from fix new add task il suo not this").split(" "));

/** deterministic rng: the map must not change on every reload */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** model-free fallback: tf-idf over words, same cosine vectors */
export function tfidfEmbeddings(texts) {
  const docs = texts.map((t) =>
    (t.toLowerCase().match(/[a-zà-ù0-9]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const vocab = [...df.keys()];
  const index = new Map(vocab.map((w, i) => [w, i]));
  return docs.map((d) => {
    const v = new Array(vocab.length).fill(0);
    for (const w of d) v[index.get(w)] += Math.log(docs.length / (1 + df.get(w)));
    return normalize(v);
  });
}

/** @returns {{theme:number[], themeNames:string[], themeEdges:[number,number,number][], sim:(i,j)=>number}} */
export function clusterize(vectors, titles) {
  const n = vectors.length;
  const sim = (i, j) => dot(vectors[i], vectors[j]);
  // mutual 3-NN: an edge exists only if the two nodes pick each other
  const neighbours = vectors.map((_, i) => {
    const order = [];
    for (let j = 0; j < n; j += 1) if (j !== i) order.push([sim(i, j), j]);
    order.sort((a, b) => b[0] - a[0]);
    return new Set(order.slice(0, 3).map(([, j]) => j));
  });
  const edges = [];
  for (let i = 0; i < n; i += 1)
    for (const j of neighbours[i])
      if (j > i && neighbours[j].has(i)) edges.push([i, j, sim(i, j)]);
  // label propagation, deterministic
  const label = Array.from({ length: n }, (_, i) => i);
  const adj = new Map();
  for (const [i, j] of edges) {
    (adj.get(i) ?? adj.set(i, []).get(i)).push(j);
    (adj.get(j) ?? adj.set(j, []).get(j)).push(i);
  }
  const rng = mulberry32(20260822);
  for (let round = 0; round < 8; round += 1) {
    const order = Array.from({ length: n }, (_, i) => i)
      .map((i) => [rng(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    let changes = 0;
    for (const i of order) {
      const near = adj.get(i);
      if (!near) continue;
      const votes = new Map();
      for (const j of near) votes.set(label[j], (votes.get(label[j]) ?? 0) + 1);
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (best !== label[i]) { label[i] = best; changes += 1; }
    }
    if (!changes) break;
  }
  // themes = groups with at least 3 members, renumbered by size; the rest is -1
  const sizes = new Map();
  for (const l of label) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const kept = [...sizes.entries()].filter(([, s]) => s >= 3)
    .sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const renumber = new Map(kept.map((l, i) => [l, i]));
  const theme = label.map((l) => renumber.get(l) ?? -1);
  // theme label: the three most frequent words in the members' titles
  const themeNames = kept.map((l) => {
    const words = new Map();
    for (let i = 0; i < n; i += 1) {
      if (label[i] !== l) continue;
      for (const w of (titles[i].toLowerCase().match(/[a-zà-ù0-9]{3,}/g) ?? []))
        if (!STOPWORDS.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
    }
    return [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(" ") || "tema";
  });
  return { theme, themeNames, themeEdges: edges.map(([i, j, s]) => [i, j, Math.round(s * 1000) / 1000]), sim };
}

/** time edges with a variable window: openings close together AND text >= threshold */
export function timeEdges(tasks, sim, windowDays, cap = 300) {
  const out = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i].openedDay, b = tasks[j].openedDay;
      if (a == null || b == null || Math.abs(a - b) > windowDays) continue;
      const s = sim(i, j);
      if (s >= 0.55) out.push([i, j, Math.round(s * 1000) / 1000]);
    }
  }
  return out.sort((x, y) => y[2] - x[2]).slice(0, cap);
}

/**
 * Parenthood suggestions: for each parentless task, the best candidate born
 * BEFORE it — creation proximity + life overlap + text. Proposals, never
 * automatic edges: dates alone are wrong 94 times out of 100.
 */
export function parentSuggestions(tasks, sim, threshold = 0.8, cap = 80) {
  const out = [];
  const isParent = new Set(tasks.filter((t) => t.parentIndex != null).map((t) => t.parentIndex));
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i];
    if (t.parentIndex != null || isParent.has(i) || t.openedDay == null) continue;
    let best = null;
    for (let j = 0; j < tasks.length; j += 1) {
      if (j === i || tasks[j].openedDay == null || tasks[j].openedDay > t.openedDay) continue;
      const textSim = sim(i, j);
      if (textSim < 0.55) continue;   // measured: without the text gate, dates are wrong 94 times out of 100
      const proximity = Math.exp(-Math.abs(t.openedDay - tasks[j].openedDay) / 7);
      const endJ = tasks[j].closedDay ?? Infinity;
      const overlap = t.openedDay <= endJ ? 1 : 0;
      const score = 0.5 * proximity + 0.3 * overlap + 0.2 * Math.max(textSim, 0);
      if (!best || score > best.score) best = { j, score };
    }
    if (best && best.score >= threshold)
      out.push([best.j, i, Math.round(best.score * 1000) / 1000]); // arrow: from likely parent to child
  }
  // a few good proposals beat a carpet of arrows: keep the most confident
  return out.sort((a, b) => b[2] - a[2]).slice(0, cap);
}
