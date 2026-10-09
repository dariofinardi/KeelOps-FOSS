/**
 * Live self-test of the TasksMap plugin, run against a COPY of the database
 * (never the original: the test creates fake sessions).
 * `node selftest.mjs <copy-of-db>`
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node selftest.mjs <copy-of-db>"); process.exit(1); }
const PORT = 5399;
const BASE = `http://127.0.0.1:${PORT}`;

// fake sessions for an admin and a member, written straight into the copy
const db = new DatabaseSync(DB_PATH);
const mk = (role) => {
  const u = db.prepare(`SELECT id, name FROM User WHERE role = ? AND isActive = 1 AND isSystem = 0 LIMIT 1`).get(role);
  const sid = randomBytes(24).toString("hex");
  // the core stores the token's DIGEST, not the token: same thing here
  const hashed = createHash("sha256").update(sid).digest("hex");
  db.prepare(`INSERT INTO Session (id, userId, expiresAt, createdAt) VALUES (?, ?, datetime('now','+1 hour'), datetime('now'))`).run(hashed, u.id);
  return { sid, ...u };
};
const admin = mk("ADMIN"), member = mk("MEMBER");
db.close();

const server = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), KEELOPS_DB: DB_PATH, OLLAMA_URL: process.env.OLLAMA_URL ?? "",
         KEELOPS_URL: "https://crm.example", SESSION_COOKIE: "kancrm_session" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise((ok) => server.stdout.on("data", (d) => { if (String(d).includes("listening on")) ok(); }));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); if (!cond) failures += 1; };
const call = (path, sid) => fetch(BASE + path, { headers: sid ? { cookie: `kancrm_session=${sid}` } : {} });

try {
  check("health risponde", (await (await call("/health")).json()).ok === true);
  const css = await call("/base.css");
  check("base.css dell'SDK è servito", css.status === 200 && (await css.text()).includes("--carta"));
  check("senza sessione: 401", (await call("/api/progetti")).status === 401);
  const adminProjects = (await (await call("/api/progetti", admin.sid)).json()).progetti;
  const memberProjects = (await (await call("/api/progetti", member.sid)).json()).progetti;
  check(`admin vede progetti (${adminProjects.length})`, adminProjects.length > 0);
  check(`membro ne vede non di più (${memberProjects.length})`, memberProjects.length <= adminProjects.length);

  const target = adminProjects.reduce((a, b) => (b.tasks > a.tasks ? b : a));
  const map = await (await call(`/api/mappa/${encodeURIComponent(target.id)}?finestra=14`, admin.sid)).json();
  check(`mappa di «${target.name}»: ${map.nodi.length} nodi`, map.nodi.length === target.tasks);
  check(`temi trovati (${map.temi.length}, fonte ${map.fonteTemi})`, map.temi.length > 0);
  check("finestra rispettata", map.finestra === 14 && map.finestre.join() === "1,7,14,28");
  check("la mappa porta il nome del progetto", map.progetto?.nome === target.name);
  const idle = await (await call(`/api/mappa/${encodeURIComponent(target.id)}/stato`, admin.sid)).json();
  check("stato di avanzamento: fermo a mappa pronta", idle.attivo === false);
  for (const strato of ["tema", "gerarchia", "tempo", "colavoro", "suggeriti"])
    check(`strato ${strato}: ${map.archi[strato].length} archi`, Array.isArray(map.archi[strato]));
  const w1 = await (await call(`/api/mappa/${encodeURIComponent(target.id)}?finestra=1`, admin.sid)).json();
  check(`finestra 1g più stretta di 14g (${w1.archi.tempo.length} ≤ ${map.archi.tempo.length})`,
        w1.archi.tempo.length <= map.archi.tempo.length);

  check("la mappa porta l'impronta del suo insieme di task", /^[0-9a-f]{32}$/.test(map.impronta));
  const stamp = await (await call(`/api/mappa/${encodeURIComponent(target.id)}/impronta`, admin.sid)).json();
  check("l'impronta rilettta e' la stessa finche' i task non cambiano", stamp.impronta === map.impronta);
  // the tables the plugin owns: config with the two versions, the vectors (rows only with Ollama)
  {
    const t = new DatabaseSync(DB_PATH, { readOnly: true });
    const cfg = Object.fromEntries(t.prepare("SELECT name, value FROM plugin_tasksmap_config").all().map((r) => [r.name, r.value]));
    check("plugin_tasksmap_config dice struttura 1 e la versione del codice", cfg.schema_version === "1" && /^\d+\.\d+\.\d+$/.test(cfg.plugin_version ?? ""));
    const vettori = t.prepare("SELECT COUNT(*) AS n FROM plugin_tasksmap_vettore").get().n;
    check(`vettori in tabella: ${vettori} (${map.fonteTemi === "tf-idf" ? "nessuno senza Ollama" : "uno per task"})`,
          map.fonteTemi === "tf-idf" ? vettori === 0 : vettori >= map.nodi.length);
    t.close();
  }
  // the same project through the member's eyes: their tasks only, and another stamp if the set differs
  const memberMap = await (await call(`/api/mappa/${encodeURIComponent(target.id)}?finestra=14`, member.sid)).json();
  const adminIds = new Set(map.nodi.map((n) => n.id));
  check(`il membro vede un sottoinsieme (${memberMap.nodi.length} di ${map.nodi.length})`,
        memberMap.nodi.every((n) => adminIds.has(n.id)) && memberMap.nodi.length <= map.nodi.length);
  check("insiemi diversi, impronte diverse; uguali, uguali",
        (memberMap.nodi.length === map.nodi.length) === (memberMap.impronta === map.impronta));
  if (memberMap.nodi.length && memberMap.nodi.length < map.nodi.length)
    check("i temi del membro vengono solo dai suoi task (nessun indice fuori dai suoi nodi)",
          memberMap.archi.tema.every(([i, j]) => i < memberMap.nodi.length && j < memberMap.nodi.length));

  const detail = await (await call(`/api/task/${encodeURIComponent(map.nodi[0].id)}`, admin.sid)).json();
  check("dettaglio task con link", detail.title?.length > 0 && detail.apri?.includes("?task="));

  // la visibilità: il membro non deve vedere un'offerta altrui
  const dbr = new DatabaseSync(DB_PATH, { readOnly: true });
  const foreignDeal = dbr.prepare(`
    SELECT id FROM Task WHERE kind = 'DEAL' AND deletedAt IS NULL
    AND (assigneeId IS NULL OR assigneeId <> ?) AND creatorId <> ? LIMIT 1`).get(member.id, member.id);
  dbr.close();
  if (foreignDeal)
    check("il membro NON vede l'offerta altrui",
          (await call(`/api/task/${encodeURIComponent(foreignDeal.id)}`, member.sid)).status === 404);
  check("l'admin la vede",
        !foreignDeal || (await call(`/api/task/${encodeURIComponent(foreignDeal.id)}`, admin.sid)).status === 200);
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} PROVE FALLITE` : "\ntutte le prove passano");
process.exit(failures ? 1 : 0);
