// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live self-test of the Personale plugin, against a COPY of the database
 * (never the original: it creates fake sessions and writes boards).
 * `node selftest.mjs <copy-of-db>`
 *
 * The cases are the 24 the core kept in `test/boards.test.ts`, one by one and
 * under the same names: this is the coherence checklist of
 * `plan/plugin-personale.md`, S2 — when all of them pass, the rules are all
 * there. Plus the two the plugin adds: the prefix gate, and that nothing of
 * the core's `Task` table is touched.
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node selftest.mjs <copy-of-db>"); process.exit(1); }
const PORT = 5321;
const BASE = `http://127.0.0.1:${PORT}`;

// two fake internal users with sessions, written straight into the copy
const raw = new DatabaseSync(DB_PATH);
const mkUser = (suffix) => {
  const id = `selftest-${suffix}-${randomBytes(4).toString("hex")}`;
  raw.prepare(`INSERT INTO User (id, email, name, role, authProvider, isActive, createdAt, updatedAt)
               VALUES (?, ?, ?, 'MEMBER', 'password', 1, datetime('now'), datetime('now'))`)
    .run(id, `${id}@selftest.local`, `Utente ${suffix}`);
  const sid = randomBytes(24).toString("hex");
  raw.prepare(`INSERT INTO Session (id, userId, expiresAt, createdAt) VALUES (?, ?, datetime('now','+1 hour'), datetime('now'))`)
    .run(createHash("sha256").update(sid).digest("hex"), id);
  return { id, sid };
};
const anna = mkUser("anna");
const bruno = mkUser("bruno");
const coreTasksBefore = raw.prepare("SELECT COUNT(*) AS n FROM Task").get().n;
raw.close();

const server = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), KEELOPS_DB: DB_PATH, KEELOPS_URL: "https://crm.example", SESSION_COOKIE: "kancrm_session" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise((ok) => server.stdout.on("data", (d) => { if (String(d).includes("listening on")) ok(); }));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); if (!cond) failures += 1; };
const as = (user, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: `kancrm_session=${user.sid}`, ...(init.headers ?? {}) },
  });

try {
  console.log("board — creazione e default");
  let r = await as(anna, "/api/boards");
  let { boards } = await r.json();
  check("crea una board personale con gli stati di default (1 iniziale, 1 chiuso)",
    boards.length === 1 && boards[0].name === "Mia" && boards[0].statuses.length === 5 &&
    boards[0].statuses.filter((s) => s.isInitial).length === 1 && boards[0].statuses.filter((s) => s.isClosed).length === 1);
  r = await as(anna, "/api/boards", { method: "POST", body: JSON.stringify({ name: "GTD", template: "gtd" }) });
  const gtd = await r.json();
  check("template 'gtd': crea le colonne del template con 1 iniziale e 1 chiuso",
    r.status === 201 && gtd.statuses.length === 5 && gtd.statuses[0].isInitial && gtd.statuses[4].isClosed);
  r = await as(anna, "/api/boards", { method: "POST", body: JSON.stringify({ name: "Base", template: "empty" }) });
  const base = await r.json();
  check("template 'empty' equivale al default (Da fare / In corso / Fatto)",
    base.statuses.map((s) => s.name).join("/") === "Da fare/In corso/Fatto");
  r = await as(anna, "/api/boards", { method: "POST", body: JSON.stringify({ name: "X", template: "marziano" }) });
  check("rifiuta un template inesistente", r.status === 400);

  console.log("board — visibilità e permessi");
  r = await as(bruno, `/api/boards/${gtd.id}/tasks`);
  const r2 = await as(bruno, `/api/boards/${gtd.id}`, { method: "PATCH", body: JSON.stringify({ name: "Mia!" }) });
  check("una board personale è privata: l'altro utente non la vede né la tocca", r.status === 404 && r2.status === 404);
  r = await as(bruno, "/api/boards");
  const brunoBoards = (await r.json()).boards;
  check("solo le proprie: l'elenco dell'altro non contiene le mie (le condivise non esistono più)",
    brunoBoards.every((b) => b.name === "Mia" && b.id !== boards[0].id) && brunoBoards.every((b) => b.shared === false));

  console.log("board — configurazione stati (vincoli)");
  const put = (statuses) => as(anna, `/api/boards/${base.id}/statuses`, { method: "PUT", body: JSON.stringify({ statuses }) });
  const st = (name, isInitial, isClosed, id) => ({ id, name, color: "#000", isInitial, isClosed });
  check("prepara una board", base.statuses.length === 3);
  const noInitial = (await put([st("a", false, false), st("b", false, true)])).status;
  const twoInitial = (await put([st("a", true, false), st("b", true, true)])).status;
  const noClosed = (await put([st("a", true, false), st("b", false, false)])).status;
  const initialClosed = (await put([st("a", true, true)])).status;
  const dupNames = (await put([st("a", true, false), st("A", false, true)])).status;
  check("rifiuta 0 o 2 stati iniziali, nessuno chiuso, iniziale-chiuso, nomi doppi",
    [noInitial, twoInitial, noClosed, initialClosed, dupNames].every((s) => s === 400));
  const keepId = base.statuses[0].id;
  r = await put([st("Da fare", true, false, keepId), st("Nuova", false, false), st("Fatto", false, true)]);
  const replaced = await r.json();
  check("sostituisce gli stati conservando gli id di quelli mantenuti",
    r.status === 200 && replaced.statuses[0].id === keepId && replaced.statuses.length === 3 &&
    replaced.statuses[1].name === "Nuova" && !base.statuses.some((s) => s.id === replaced.statuses[2].id));

  console.log("board — rinomina ed elimina");
  r = await as(anna, `/api/boards/${base.id}`, { method: "PATCH", body: JSON.stringify({ name: "Base rinominata" }) });
  const renamed = await r.json();
  const del = await as(anna, `/api/boards/${base.id}`, { method: "DELETE" });
  const after = (await (await as(anna, "/api/boards")).json()).boards;
  check("rinomina e poi elimina la board",
    renamed.name === "Base rinominata" && del.status === 204 && !after.some((b) => b.id === base.id));

  console.log("board — task (kanban)");
  const board = gtd;
  const initial = board.statuses.find((s) => s.isInitial);
  const closed = board.statuses.find((s) => s.isClosed);
  const other = board.statuses.find((s) => !s.isInitial && !s.isClosed);
  check("prepara una board e legge gli stati", Boolean(initial && closed && other));
  r = await as(anna, `/api/boards/${board.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Prima card" }) });
  const card = await r.json();
  check("crea un task nello stato iniziale, assegnato e supervisionato dal creatore",
    r.status === 201 && card.boardStatusId === initial.id && card.assignee?.id === anna.id && card.supervisor?.id === anna.id && card.closedAt === null);
  r = await as(anna, `/api/boards/${board.id}/tasks`);
  check("elenca i task della board", (await r.json()).tasks.some((t) => t.id === card.id));
  r = await as(anna, `/api/boards/${board.id}/tasks/${card.id}`, { method: "PATCH", body: JSON.stringify({ boardStatusId: closed.id }) });
  const closedCard = await r.json();
  check("sposta un task in una colonna di chiusura: closedAt valorizzato", typeof closedCard.closedAt === "string");
  r = await as(anna, `/api/boards/${board.id}/tasks/${card.id}`, { method: "PATCH", body: JSON.stringify({ boardStatusId: other.id }) });
  check("uscendo dalla colonna chiusa closedAt torna null", (await r.json()).closedAt === null);
  r = await as(anna, `/api/boards/${board.id}/tasks/${card.id}`, { method: "PATCH", body: JSON.stringify({ boardStatusId: boards[0].statuses[0].id }) });
  check("rifiuta uno stato che non appartiene alla board", r.status === 400);
  const c1 = await as(bruno, `/api/boards/${board.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Intruso" }) });
  const c2 = await as(bruno, `/api/boards/${board.id}/tasks`);
  check("board personale altrui: l'altro utente non crea né elenca i task (404)", c1.status === 404 && c2.status === 404);
  r = await as(anna, `/api/boards/${board.id}/tasks/${card.id}`, { method: "DELETE" });
  const gone = (await (await as(anna, `/api/boards/${board.id}/tasks?includeArchived=1`)).json()).tasks;
  check("board personale: elimina il task in modo DEFINITIVO (non passa dal cestino)",
    r.status === 204 && !gone.some((t) => t.id === card.id));

  console.log("board — default 'Mia', ora e archiviazione");
  const fresh = mkUserLater();
  r = await as(fresh, "/api/boards");
  const mia = (await r.json()).boards;
  check("al primo accesso crea la board 'Mia' con 5 stati", mia.length === 1 && mia[0].name === "Mia" && mia[0].statuses.length === 5);
  await as(fresh, `/api/boards/${mia[0].id}`, { method: "DELETE" });
  const none = (await (await as(fresh, "/api/boards")).json()).boards;
  check("eliminando l'ultima board personale non ne rinasce una", none.length === 0);
  r = await as(anna, `/api/boards/${board.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Con orario", dueDate: "2026-09-10", dueTime: "14:30" }) });
  const timed = await r.json();
  const arch = await (await as(anna, `/api/boards/${board.id}/tasks/${timed.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) })).json();
  const visible = (await (await as(anna, `/api/boards/${board.id}/tasks`)).json()).tasks;
  const withArchived = (await (await as(anna, `/api/boards/${board.id}/tasks?includeArchived=1`)).json()).tasks;
  check("crea un task con orario e lo archivia (escluso, ripristinabile con includeArchived)",
    timed.dueTime === "14:30" && timed.dueDate === "2026-09-10" && arch.archived === true &&
    !visible.some((t) => t.id === timed.id) && withArchived.some((t) => t.id === timed.id));
  const badTime = await as(anna, `/api/boards/${board.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "x", dueTime: "25:99" }) });
  check("un orario impossibile si rifiuta", badTime.status === 400);

  console.log("board — non contaminano lo scadenzario e cancellazioni sicure");
  const check1 = new DatabaseSync(DB_PATH, { readOnly: true });
  const coreTasksAfter = check1.prepare("SELECT COUNT(*) AS n FROM Task").get().n;
  check1.close();
  check("i task di bacheca non entrano nella tabella Task del core", coreTasksAfter === coreTasksBefore);
  r = await as(anna, `/api/boards/${board.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Blocca la colonna", boardStatusId: other.id }) });
  const blocker = await r.json();
  const statusesWithout = board.statuses.filter((s) => s.id !== other.id).map((s) => st(s.name, s.isInitial, s.isClosed, s.id));
  r = await as(anna, `/api/boards/${board.id}/statuses`, { method: "PUT", body: JSON.stringify({ statuses: statusesWithout }) });
  check("non elimina una colonna che contiene task", r.status === 400);
  await as(anna, `/api/boards/${board.id}`, { method: "DELETE" });
  const check2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const orphans = check2.prepare("SELECT COUNT(*) AS n FROM plugin_personale_task WHERE id = ?").get(blocker.id).n;
  const orphanStatuses = check2.prepare("SELECT COUNT(*) AS n FROM plugin_personale_status WHERE boardId = ?").get(board.id).n;
  check2.close();
  check("eliminando una board ne elimina i task (nessun orfano)", orphans === 0 && orphanStatuses === 0);

  console.log("errori mappati");
  r = await as(anna, "/api/boards", { method: "POST", body: JSON.stringify({ name: "Mia" }) });
  check("un nome board duplicato per lo stesso utente → 409, non 500", r.status === 409);
  r = await fetch(`${BASE}/api/boards`);
  check("senza sessione → 401", r.status === 401);
  r = await as(anna, "/api/dashboard");
  const dash = await r.json();
  check("il riquadro della giornata elenca le mie card aperte", r.status === 200 && Array.isArray(dash.tasks) && dash.me.id === anna.id);

  console.log("i gruppi della giornata e il riepilogo del mattino");
  {
    const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const ieri = new Date(`${oggi}T00:00:00Z`); ieri.setUTCDate(ieri.getUTCDate() - 1);
    const b = await (await as(anna, "/api/boards", { method: "POST", body: JSON.stringify({ name: "Scadenze", template: "empty" }) })).json();
    await as(anna, `/api/boards/${b.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "In ritardo", dueDate: ieri.toISOString().slice(0, 10) }) });
    await as(anna, `/api/boards/${b.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Per oggi", dueDate: oggi }) });
    await as(anna, `/api/boards/${b.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "Quando capita" }) });
    const g = (await (await as(anna, "/api/gruppi")).json()).gruppi;
    check("api/gruppi conta le card per gruppo della giornata", g.overdue >= 1 && g.today >= 1 && g.none >= 1 && g.tomorrow === 0);
    const solo = (await (await as(anna, "/api/dashboard?gruppo=overdue")).json()).tasks;
    check("api/dashboard?gruppo= elenca solo quel gruppo", solo.length === g.overdue && solo.every((t) => t.gruppo === "overdue"));
    check("un gruppo sconosciuto → 400", (await as(anna, "/api/dashboard?gruppo=boh")).status === 400);
    // the plugin's contribution to the morning digest, as the core calls it
    const { openWritableSqlite } = await import("../keelops-sdk/database.mjs");
    const { create } = await import("./plugin.mjs");
    const dbw = openWritableSqlite(DB_PATH, "personale");
    const def = create({ db: dbw, keelopsUrl: "", sessionUser: async () => null });
    const contributi = await def.riepilogoMattutino({ oggi });
    const mio = contributi.find((c) => c.userId === anna.id);
    check("riepilogoMattutino nomina chi ha card in ritardo o in scadenza", Boolean(mio));
    check("e scrive la riga nella lingua chiesta", mio?.righe("it")[0]?.startsWith("Bacheche personali: ") && mio?.righe("en")[0]?.startsWith("Personal boards: "));
    await dbw.close();
  }
} finally {
  server.kill();
}

/** A user created after the server started: the first access must still work. */
function mkUserLater() {
  const db = new DatabaseSync(DB_PATH);
  const id = `selftest-fresh-${randomBytes(4).toString("hex")}`;
  db.prepare(`INSERT INTO User (id, email, name, role, authProvider, isActive, createdAt, updatedAt)
              VALUES (?, ?, ?, 'MEMBER', 'password', 1, datetime('now'), datetime('now'))`).run(id, `${id}@selftest.local`, "Utente fresco");
  const sid = randomBytes(24).toString("hex");
  db.prepare(`INSERT INTO Session (id, userId, expiresAt, createdAt) VALUES (?, ?, datetime('now','+1 hour'), datetime('now'))`)
    .run(createHash("sha256").update(sid).digest("hex"), id);
  db.close();
  return { id, sid };
}

console.log(failures ? `\n${failures} PROVE FALLITE` : "\ntutte le prove passano");
process.exit(failures ? 1 : 0);
