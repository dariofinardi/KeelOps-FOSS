// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The map routes, independent of HOW the plugin is served: the core uses them
 * when the plugin is side-loaded, `server.mjs` in standalone mode.
 *
 * ctx: { db, keelopsUrl, ollamaUrl, version, sessionUser(req) } —
 * `sessionUser` may be async (in the core it is: it goes through Prisma).
 *
 * What is kept and what is not (06/09/2026): the vectors of the tasks live in
 * the plugin's table, shared by everyone and valid until the text changes;
 * the graph itself — themes, edges, suggestions — is computed per request
 * from the vectors of the tasks *this* user sees, and held in memory for a
 * few minutes under a stamp of that exact set. A graph stored whole under
 * the project's name carried one person's perimeter to the next.
 */
import { createHash } from "node:crypto";
import { json } from "../../keelops-sdk/http.mjs";
import { BASE_CSS, TEMA_SCRIPT } from "../../keelops-sdk/ui.mjs";
import { listProjects, projectTasks, coworkEdges, taskDetail } from "./data.mjs";
import { clusterize, timeEdges, parentSuggestions } from "./graph.mjs";
import { vectorsFor } from "./vectors.mjs";

const WINDOWS = [1, 7, 14, 28];   // the selectable time windows
const MEMORY_TTL_MS = 10 * 60_000;
const MEMORY_MAX = 32;

/**
 * The stamp of a set of tasks as one user sees it: which tasks, and the last
 * time any of them changed. Same set, same stamp — a different perimeter,
 * or one edited title, and it is another map.
 */
export function stampOf(tasks) {
  const ids = tasks.map((t) => t.id).sort();
  const latest = tasks.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), "");
  return createHash("sha256").update(`${ids.length}\n${ids.join(",")}\n${latest}`).digest("hex").slice(0, 32);
}

export function buildRoutes(ctx) {
  /**
   * Embedding a big project takes tens of seconds: while it runs, the UI
   * polls /api/mappa/<id>/stato and draws a progress bar with elapsed and
   * estimated time. One build at a time per project is all we need.
   */
  const jobs = new Map();
  /** stamp → { vectors, source, clusters, at }: the expensive part of a map, for a while */
  const memory = new Map();

  async function requireUser(req, res) {
    const user = await ctx.sessionUser(req);
    if (!user) {
      json(res, 401, { errore: "serve una sessione KeelOps attiva",
                       accedi: ctx.keelopsUrl ? `${ctx.keelopsUrl}/login` : null });
      return null;
    }
    return user;
  }

  /** The graph for this exact set of tasks: from memory, or computed (and remembered). */
  async function graphFor(projectId, tasks) {
    const stamp = stampOf(tasks);
    const hit = memory.get(stamp);
    if (hit && Date.now() - hit.at < MEMORY_TTL_MS) { hit.at = Date.now(); return { ...hit, stamp }; }
    const job = { totale: tasks.length, fatti: 0, avviato: Date.now() };
    jobs.set(projectId, job);
    try {
      const { vectors, source } = await vectorsFor(ctx.db, tasks, ctx.ollamaUrl,
        (done, total) => { job.fatti = done; job.totale = total || tasks.length; });
      const clusters = clusterize(vectors, tasks.map((t) => t.title));
      const entry = { vectors, source, clusters, at: Date.now() };
      memory.set(stamp, entry);
      if (memory.size > MEMORY_MAX) {
        const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) memory.delete(oldest[0]);
      }
      return { ...entry, stamp };
    } finally { jobs.delete(projectId); }
  }

  return [
    // the shared KeelOps tokens for the static UI (linked from index.html)
    ["GET", /^\/base\.css$/, (req, res) => {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(BASE_CSS);
    }],

    // Il tema dell'applicazione che ospita la pagina (SDK): la scrive su data-tema.
    ["GET", /^\/tema\.js$/, (req, res) => {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(TEMA_SCRIPT);
    }],

    ["GET", /^\/health$/, (req, res) =>
      json(res, 200, { ok: true, plugin: "TasksMap", versione: ctx.version })],

    ["GET", /^\/api\/progetti$/, async (req, res) => {
      const user = await requireUser(req, res);
      if (user) json(res, 200, { utente: user.name, lingua: user.locale ?? null,
                                 progetti: await listProjects(ctx.db, user) });
    }],

    ["GET", /^\/api\/mappa\/([^/]+)$/, async (req, res, match, url) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const projectId = decodeURIComponent(match[1]);
      const windowDays = WINDOWS.includes(Number(url.searchParams.get("finestra")))
        ? Number(url.searchParams.get("finestra")) : 7;
      const tasks = await projectTasks(ctx.db, user, projectId);
      if (!tasks.length) return json(res, 200, { nodi: [], temi: [], archi: {}, impronta: stampOf([]) });

      if (url.searchParams.get("ricalcola")) memory.delete(stampOf(tasks));
      const graph = await graphFor(projectId, tasks);
      const v = graph.vectors;
      const sim = (i, j) => { let s = 0; const a = v[i], b = v[j]; for (let k = 0; k < a.length; k += 1) s += a[k] * b[k]; return s; };
      const hierarchy = [];
      tasks.forEach((t, i) => {
        if (t.parentIndex != null) hierarchy.push([t.parentIndex, i, "padre"]);
        if (t.predecessorIndex != null) hierarchy.push([t.predecessorIndex, i, "sequenza"]);
      });
      json(res, 200, {
        lingua: user.locale ?? null,
        progetto: { id: projectId,
          nome: (await listProjects(ctx.db, user)).find((p) => p.id === projectId)?.name ?? null },
        impronta: graph.stamp,
        fonteTemi: graph.source,
        finestra: windowDays,
        finestre: WINDOWS,
        temi: graph.clusters.themeNames,
        nodi: tasks.map((t, i) => ({
          id: t.id, titolo: t.title, chiuso: t.closed, tema: graph.clusters.theme[i],
          assegnatario: t.assignee, apertura: t.openedDay, aggiornamento: t.updatedDay,
        })),
        archi: {
          tema: graph.clusters.themeEdges,
          gerarchia: hierarchy,
          tempo: timeEdges(tasks, sim, windowDays),
          colavoro: await coworkEdges(ctx.db, tasks),
          suggeriti: parentSuggestions(tasks, sim),
        },
      });
    }],

    // the build's live progress; {attivo:false} when nothing is running
    ["GET", /^\/api\/mappa\/([^/]+)\/stato$/, async (req, res, match) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const job = jobs.get(decodeURIComponent(match[1]));
      json(res, 200, job
        ? { attivo: true, fatti: job.fatti, totale: job.totale, trascorsoMs: Date.now() - job.avviato }
        : { attivo: false });
    }],

    // the stamp of the map as this user sees it now: the UI polls it and reloads when it moves
    ["GET", /^\/api\/mappa\/([^/]+)\/impronta$/, async (req, res, match) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const tasks = await projectTasks(ctx.db, user, decodeURIComponent(match[1]));
      json(res, 200, { impronta: stampOf(tasks) });
    }],

    ["GET", /^\/api\/task\/([^/]+)$/, async (req, res, match) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const detail = await taskDetail(ctx.db, user, decodeURIComponent(match[1]));
      if (!detail) return json(res, 404, { errore: "task non trovato o non visibile" });
      json(res, 200, { ...detail,
        apri: ctx.keelopsUrl ? `${ctx.keelopsUrl}/bacheche?task=${encodeURIComponent(detail.id)}` : null });
    }],
  ];
}
