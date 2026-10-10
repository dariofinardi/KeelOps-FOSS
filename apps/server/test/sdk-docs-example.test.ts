// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { dbPath } = prepareTestDb("sdk-docs-example");

/**
 * **L'esempio della documentazione dell'SDK funziona davvero** (24/09/2026).
 *
 * `plugins/keelops-sdk/docs/01-getting-started.md` costruisce un plugin,
 * «Hello», un blocco di codice alla volta. Una guida il cui esempio non gira è
 * peggio di nessuna guida: chi comincia da lì e sbatte contro un errore non sa
 * se ha sbagliato lui o la pagina. Qui i blocchi si prendono **dal documento**
 * — il primo `json` è il manifesto, gli altri dicono il loro file nella prima
 * riga — si scrivono in una cartella di plugin, e un server vero li carica.
 * Se l'SDK cambia e la guida no, questa prova si ferma.
 */
const guida = readFileSync(
  path.resolve(import.meta.dirname, "../../../plugins/keelops-sdk/docs/01-getting-started.md"),
  "utf8",
);
const blocchi = [...guida.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({ lingua: m[1]!, corpo: m[2]! }));

/** Il file che un blocco dichiara nella prima riga: `// plugins/Hello/…` o `<!-- plugins/Hello/… -->`. */
function fileDi(corpo: string): string | null {
  const m = /^(?:\/\/|<!--)\s*plugins\/Hello\/([\w./-]+)/.exec(corpo.trim());
  return m ? m[1]! : null;
}

const pluginsDir = path.join(os.tmpdir(), `kancrm-sdk-docs-${process.pid}`);
const serverDir = path.resolve(import.meta.dirname, "..");
const port = 4800 + (process.pid % 400);
const base = `http://127.0.0.1:${port}`;
const token = randomBytes(24).toString("hex");
let server: ChildProcess | undefined;
let publicDirCreato = false;

beforeAll(async () => {
  // il manifesto è il primo blocco json; gli altri file li dicono i blocchi stessi
  const manifesto = blocchi.find((b) => b.lingua === "json");
  if (!manifesto) throw new Error("la guida non ha più il blocco del manifesto");
  mkdirSync(path.join(pluginsDir, "Hello", "ui"), { recursive: true });
  writeFileSync(path.join(pluginsDir, "Hello", "manifest.json"), manifesto.corpo);
  for (const b of blocchi) {
    const file = fileDi(b.corpo);
    if (file) writeFileSync(path.join(pluginsDir, "Hello", file), b.corpo);
  }

  const publicDir = path.join(serverDir, "public");
  if (!existsSync(path.join(publicDir, "index.html"))) {
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>x</title>");
    publicDirCreato = true;
  }

  server = spawn(path.join(serverDir, "node_modules", ".bin", "tsx"), ["src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: String(port),
      PLUGINS: "Hello",
      PLUGINS_DIR: pluginsDir,
      LOG_DIR: path.join(pluginsDir, "logs"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let coda = "";
  server.stderr?.on("data", (d) => {
    coda = (coda + String(d)).slice(-2000);
  });
  const scadenza = Date.now() + 40_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {
      /* non ancora su */
    }
    if (Date.now() > scadenza) throw new Error(`il server di prova non è partito. stderr:\n${coda}`);
    await new Promise((ok) => setTimeout(ok, 400));
  }

  // una persona con una sessione, e due task suoi: uno aperto e uno chiuso
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO User (id, email, name, role, authProvider, isActive, createdAt, updatedAt)
     VALUES ('utente-hello', 'hello@test.local', 'Anna', 'MEMBER', 'password', 1, datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO Session (id, userId, expiresAt, createdAt) VALUES (?, 'utente-hello', datetime('now', '+1 hour'), datetime('now'))`,
  ).run(createHash("sha256").update(token).digest("hex"));
  db.prepare(`INSERT INTO TaskStatus (id, name, color, "order", isClosed) VALUES ('st-aperto', 'Aperto', '#000', 1, 0)`).run();
  db.prepare(`INSERT INTO TaskStatus (id, name, color, "order", isClosed) VALUES ('st-chiuso', 'Chiuso', '#000', 2, 1)`).run();
  for (const [id, stato] of [["t-aperto", "st-aperto"], ["t-chiuso", "st-chiuso"]]) {
    db.prepare(
      `INSERT INTO Task (id, title, kind, statusId, creatorId, assigneeId, createdAt, updatedAt)
       VALUES (?, 'Prova', 'ADMIN', ?, 'utente-hello', 'utente-hello', datetime('now'), datetime('now'))`,
    ).run(id, stato);
  }
  db.close();
}, 60_000);

afterAll(() => {
  server?.kill();
  rmSync(pluginsDir, { recursive: true, force: true });
  if (publicDirCreato) rmSync(path.join(serverDir, "public"), { recursive: true, force: true });
});

describe("l'esempio di «Getting started» dell'SDK", () => {
  const conSessione = { headers: { cookie: `kancrm_session_dev=${token}` } };

  it("la guida porta tutti i file del plugin", () => {
    const file = blocchi.map((b) => fileDi(b.corpo)).filter(Boolean);
    expect(file).toEqual(expect.arrayContaining(["plugin.mjs", "ui/index.html", "ui/app.js"]));
  });

  it("si carica, e risponde sul percorso di salute senza sessione", async () => {
    const r = await fetch(`${base}/plugins/Hello/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  it("compare nel menu con la voce del manifesto", async () => {
    const ui = await (await fetch(`${base}/api/plugins/ui`, conSessione)).json();
    expect(ui.plugins).toEqual([expect.objectContaining({ nome: "Hello", voce: "Hello", menu: true })]);
  });

  it("la rotta legge la persona vera e i suoi task aperti", async () => {
    const r = await fetch(`${base}/plugins/Hello/api/summary`, conSessione);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ name: "Anna", open: 1 });
  });

  it("senza sessione la rotta non si raggiunge", async () => {
    expect((await fetch(`${base}/plugins/Hello/api/summary`)).status).toBe(401);
  });

  it("la pagina e il foglio di stile arrivano, con gli script dell'SDK", async () => {
    const pagina = await (await fetch(`${base}/plugins/Hello/`, conSessione)).text();
    expect(pagina).toContain('href="base.css"');
    expect(pagina).toContain('src="sdk/tema.js"');
    const css = await fetch(`${base}/plugins/Hello/base.css`, conSessione);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain("--carta");
    expect((await fetch(`${base}/plugins/Hello/sdk/tema.js`, conSessione)).status).toBe(200);
  });
});
