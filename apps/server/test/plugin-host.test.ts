// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

const { dbPath } = prepareTestDb("plugin-host");

/**
 * Il porta-plugin side-loaded, provato per intero e ALLA PARI con la
 * produzione: i plugin sono moduli fuori dal grafo dei bundler, e vite-node
 * (che esegue questi test) non sa caricarli — il server quindi si avvia come
 * SOTTOPROCESSO vero (tsx, come in sviluppo) e lo si interroga via HTTP.
 * Si verifica che rotte, corpi POST, statici, redirect, forma per inserzione
 * dei well-known e l'autenticazione vera del core arrivino fino al plugin.
 */
const pluginsDir = path.join(os.tmpdir(), `kancrm-plugin-host-${process.pid}`);
const serverDir = path.resolve(import.meta.dirname, "..");
/**
 * The edition of the spawned server, as the server itself declares it in
 * /api/auth/providers (read in beforeAll): the community when told so, or when
 * the commercial module list is the empty stub of the exported tree — there
 * KEELOPS_EDITION is usually not set at all (the GitHub CI does not set it).
 */
let community = false;
mkdirSync(path.join(pluginsDir, "eco", "ui"), { recursive: true });
writeFileSync(
  path.join(pluginsDir, "eco", "ui", "index.html"),
  "<!doctype html><title>pagina eco</title>",
);
writeFileSync(
  path.join(pluginsDir, "eco", "plugin.mjs"),
  `
export const manifest = { nome: "eco", versione: "0.0.1", titolo: "Eco di prova", copyright: "© 2026 Prova", licenza: "libero", sommario: { it: "Ripete.", en: "Echoes." }, ui: { voce: "Eco", icona: "puzzle" }, anchors: { project: true }, pubblici: ["/salute", "/.well-known/", "POST /"] };
export function create(ctx) {
  return {
    staticDir: new URL("./ui", import.meta.url).pathname,
    wellKnown: ["oauth-authorization-server"],
    routes: [
      ["GET", /^\\/salute$/, (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, publicUrl: ctx.publicUrl }));
      }],
      ["GET", /^\\/aperta$/, (req, res) => {
        // scritta senza controllo di sessione, di proposito: è la guardia del core a chiuderla
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ segreto: 42 }));
      }],
      ["GET", /^\\/chi$/, async (req, res) => {
        const user = await ctx.sessionUser(req);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ utente: user }));
      }],
      ["POST", /^\\/$/, async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ corpo: Buffer.concat(chunks).toString("utf8") }));
      }],
      ["POST", /^\\/eco$/, async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ corpo: Buffer.concat(chunks).toString("utf8") }));
      }],
      ["GET", /^\\/\\.well-known\\/oauth-authorization-server$/, (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ issuer: ctx.publicUrl }));
      }],
      ["GET", /^\\/porte$/, (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ plugins: ctx.plugins, segnali: typeof ctx.segnali?.invia }));
      }],
    ],
    // uno strumento per gli altri plugin: risponde con chi è la persona, come gliela dà il core
    strumenti: [
      { nome: "saluta", descrizione: "Saluta la persona", parametri: { type: "object", properties: { come: { type: "string" } } },
        esegui: async (utente, p) => ({ ciao: utente.name, ruolo: utente.role, come: p.come ?? null }) },
      { nome: "Nome Sbagliato", descrizione: "scartato dal core", esegui: async () => ({}) },
    ],
  };
}
`,
);

/**
 * **Un plugin che usa gli strumenti degli altri** (il tunnel, 23/09/2026):
 * chiede `plugins:strumenti`, e ha un bottone nella barra (`ui.barra`).
 */
mkdirSync(path.join(pluginsDir, "tunnel", "ui"), { recursive: true });
writeFileSync(path.join(pluginsDir, "tunnel", "ui", "segno.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
writeFileSync(
  path.join(pluginsDir, "tunnel", "plugin.mjs"),
  `
export const manifest = { nome: "tunnel", versione: "0.1.0", titolo: "Tunnel", permessi: ["plugins:strumenti"],
  ui: { voce: "Tunnel", menu: false, barra: { icona: "segno.svg", stato: "api/barra", pannello: "barra" } } };
export function create(ctx) {
  const json = (res, s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  return {
    staticDir: new URL("./ui", import.meta.url).pathname,
    routes: [
      ["GET", /^\\/elenco$/, (req, res) => json(res, 200, { strumenti: ctx.plugins.strumenti().map(({ esegui, ...s }) => s) })],
      ["GET", /^\\/esegui$/, async (req, res) => {
        const q = new URL(req.url, "http://x").searchParams;
        const s = ctx.plugins.strumenti().find((x) => x.nome === q.get("nome"));
        try { json(res, 200, await s.esegui(q.get("utente"), { come: "forte" })); }
        catch (err) { json(res, 400, { errore: err.message }); }
      }],
    ],
  };
}
`,
);

/**
 * **Un plugin che possiede tabelle.** Nick `magazzino`, struttura attesa alla
 * versione 2: al caricamento il core crea `plugin_magazzino_config`, chiama
 * `migrate(db, 0)`, e alla fine pretende che la tabella dica 2. Le rotte
 * provano il cancello: una scrittura sulla propria tabella passa, una sul core
 * (`Task`) no — e dice quale nome ha rifiutato. La UI chiede un posto preciso
 * nel menù, e un ruolo che non esiste, per vedere l'avviso e il ripiego.
 */
mkdirSync(path.join(pluginsDir, "magazzino"), { recursive: true });
writeFileSync(
  path.join(pluginsDir, "magazzino", "plugin.mjs"),
  `
import { applyMigrations, pluginConfig } from "${path.join(serverDir, "..", "..", "plugins", "keelops-sdk", "database.mjs")}";
export const manifest = {
  nome: "magazzino", versione: "1.2.3", nick: "magazzino", schemaVersion: 2,
  ui: { voce: "Magazzino", icona: "puzzle", sezione: "aree", dopo: "tasks", ruoli: ["MEMBER", "MARZIANO"] },
};
export function create(ctx) {
  const rispondi = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  return {
    routes: [
      ["GET", /^\\/versioni$/, async (req, res) => {
        const cfg = pluginConfig(ctx.db, "magazzino");
        rispondi(res, 200, { plugin: await cfg.get("plugin_version"), schema: await cfg.get("schema_version"), nick: ctx.db.nick });
      }],
      ["POST", /^\\/scrivi$/, async (req, res) => {
        const esito = await ctx.db.run("INSERT INTO plugin_magazzino_scaffale (id, nome) VALUES (?, ?)", "s1", "primo");
        const righe = await ctx.db.all("SELECT id, nome FROM plugin_magazzino_scaffale ORDER BY id");
        rispondi(res, 200, { changes: esito.changes, righe });
      }],
      ["POST", /^\\/sabota$/, async (req, res) => {
        try { await ctx.db.run("DELETE FROM Task"); rispondi(res, 200, { passato: true }); }
        catch (err) { rispondi(res, 200, { passato: false, errore: err.message }); }
      }],
      ["POST", /^\\/travestito$/, async (req, res) => {
        try { await ctx.db.all("WITH x AS (SELECT 1) DELETE FROM Task"); rispondi(res, 200, { passato: true }); }
        catch (err) { rispondi(res, 200, { passato: false, errore: err.message }); }
      }],
    ],
    migrate: (db, from) => applyMigrations(db, "magazzino", [
      { version: 1, up: (d) => d.run("CREATE TABLE plugin_magazzino_scaffale (id VARCHAR(191) NOT NULL PRIMARY KEY, nome TEXT NOT NULL)") },
      { version: 2, up: (d) => d.run("ALTER TABLE plugin_magazzino_scaffale ADD COLUMN note TEXT") },
    ], from),
  };
}
`,
);

/**
 * **Un plugin che si monta con un altro nome.** La cartella è `sostituto`, il
 * manifesto dice `montaCome: "eco-bis"`: risponde su /plugins/eco-bis/ e non su
 * /plugins/sostituto/. È la strada con cui il pro prende il posto della base.
 * Chiede anche le credenziali Google: nel test non ci sono, ma l'oggetto arriva.
 */
mkdirSync(path.join(pluginsDir, "sostituto"), { recursive: true });
writeFileSync(
  path.join(pluginsDir, "sostituto", "plugin.mjs"),
  `
export const manifest = { nome: "sostituto", versione: "0.1.0", montaCome: "eco-bis", permessi: ["google:oauth"], pubblici: ["/salute"], ui: { voce: "Eco bis", menu: false } };
export function create(ctx) {
  return { routes: [["GET", /^\\/salute$/, (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ montato: ctx.publicUrl, google: ctx.google ? Object.keys(ctx.google).sort() : null,
      edizione: ctx.edizione, funzioni: [...ctx.funzioni].sort(), timesheet: ctx.timesheet }));
  }]] };
}
`,
);

/**
 * **Un plugin riportato indietro.** La sua tabella di configurazione dice già
 * «struttura 9», il codice si aspetta la 1: il core non lo monta — e lo dice.
 */
mkdirSync(path.join(pluginsDir, "avanti"), { recursive: true });
writeFileSync(
  path.join(pluginsDir, "avanti", "plugin.mjs"),
  `
export const manifest = { nome: "avanti", versione: "0.1.0", nick: "avanti", schemaVersion: 1, ui: { voce: "Avanti" } };
export function create() {
  return { routes: [["GET", /^\\/ci-sei$/, (req, res) => { res.writeHead(200); res.end("si"); }]], migrate: async () => {} };
}
`,
);

/**
 * **Un plugin che chiede una funzione che non c'è** (08/10/2026): è in
 * `PLUGINS`, ma il core non lo monta, e la scheda di Sistema dice perché.
 */
mkdirSync(path.join(pluginsDir, "esigente"), { recursive: true });
const manifestoEsigente = { nome: "esigente", titolo: "Esigente", versione: "0.1.0", richiede: ["timesheet", "inesistente"] };
writeFileSync(path.join(pluginsDir, "esigente", "manifest.json"), JSON.stringify(manifestoEsigente));
writeFileSync(
  path.join(pluginsDir, "esigente", "plugin.mjs"),
  `
export const manifest = ${JSON.stringify(manifestoEsigente)};
export function create() { return { routes: [] }; }
`,
);

/**
 * **Un plugin presente ma non installato**: la cartella c'è, `PLUGINS` non lo
 * nomina. Sistema lo elenca (col suo manifest.json) senza interruttore.
 */
mkdirSync(path.join(pluginsDir, "dormiente"), { recursive: true });
writeFileSync(
  path.join(pluginsDir, "dormiente", "manifest.json"),
  JSON.stringify({ nome: "dormiente", titolo: "Dormiente", versione: "2.0.0", descrizione: "Dorme. Non si sveglia." }),
);

const port = 4300 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const token = randomBytes(24).toString("hex");
const tokenAdmin = randomBytes(24).toString("hex");
let server: ChildProcess | undefined;
let publicDirCreato = false;

beforeAll(async () => {
  // la build del frontend non c'è nei test: si finge, quel tanto che basta
  const publicDir = path.join(serverDir, "public");
  if (!existsSync(path.join(publicDir, "index.html"))) {
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>x</title>");
    publicDirCreato = true;
  }
  {
    // il plugin «avanti» trova la sua configurazione già alla versione 9
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    db.exec(
      "CREATE TABLE plugin_avanti_config (name VARCHAR(191) NOT NULL PRIMARY KEY, value TEXT NOT NULL, updatedAt VARCHAR(32) NOT NULL)",
    );
    db.prepare(
      "INSERT INTO plugin_avanti_config (name, value, updatedAt) VALUES ('schema_version', '9', '2026-09-05T00:00:00.000Z')",
    ).run();
    db.close();
  }
  server = spawn(path.join(serverDir, "node_modules", ".bin", "tsx"), ["src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: String(port),
      PLUGINS: "tunnel, eco, magazzino, avanti, nome non valido!, fantasma,sostituto,esigente",
      PLUGINS_DIR: pluginsDir,
      LOG_DIR: path.join(pluginsDir, "logs"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderrTail = "";
  server.stderr?.on("data", (d) => {
    stderrTail = (stderrTail + String(d)).slice(-2000);
  });
  server.on("exit", (code) => {
    if (code) stderrTail += `\n[exit ${code}]`;
  });
  const scadenza = Date.now() + 40_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {
      /* non ancora su */
    }
    if (Date.now() > scadenza)
      throw new Error(`il server di prova non è partito. stderr:\n${stderrTail}`);
    await new Promise((ok) => setTimeout(ok, 400));
  }
  // The edition, from the server itself: the expectations below follow it.
  const providers = (await (await fetch(`${base}/api/auth/providers`)).json()) as {
    edizione: "community" | "commerciale";
  };
  community = providers.edizione === "community";
  // l'utente e la sua sessione, scritti come li scrive il core (impronta sha256)
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO User (id, email, name, role, authProvider, isActive, createdAt, updatedAt)
              VALUES ('utente-eco', 'eco@test.local', 'Prova Eco', 'MEMBER', 'password', 1,
                      datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO Session (id, userId, expiresAt, createdAt)
              VALUES (?, 'utente-eco', datetime('now', '+1 hour'), datetime('now'))`,
  ).run(createHash("sha256").update(token).digest("hex"));
  // un super admin già elevato, per la pagina Sistema
  db.prepare(
    `INSERT INTO User (id, email, name, role, authProvider, isActive, adminUntil, createdAt, updatedAt)
              VALUES ('admin-eco', 'admin@test.local', 'Admin Eco', 'ADMIN', 'password', 1,
                      datetime('now', '+1 hour'), datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO Session (id, userId, expiresAt, createdAt)
              VALUES (?, 'admin-eco', datetime('now', '+1 hour'), datetime('now'))`,
  ).run(createHash("sha256").update(tokenAdmin).digest("hex"));
  db.close();
}, 60_000);

afterAll(() => {
  server?.kill();
  rmSync(pluginsDir, { recursive: true, force: true });
  if (publicDirCreato) rmSync(path.join(serverDir, "public"), { recursive: true, force: true });
});

describe("porta-plugin side-loaded", () => {
  it("monta le rotte del plugin sotto /plugins/<nome>/", async () => {
    const r = await (await fetch(`${base}/plugins/eco/salute`)).json();
    expect(r.ok).toBe(true);
    expect(r.publicUrl).toContain("/plugins/eco");
  });

  it("la guardia del core chiude ogni rotta non dichiarata pubblica, anche una scritta senza controllo", async () => {
    // V2: prima la guardia guardava solo /api, e questa rotta sarebbe stata aperta a tutti
    const anonimo = await fetch(`${base}/plugins/eco/aperta`);
    expect(anonimo.status).toBe(401);
    const chi = await fetch(`${base}/plugins/eco/chi`);
    expect(chi.status).toBe(401);
    const dentro = await fetch(`${base}/plugins/eco/aperta`, {
      headers: { cookie: `kancrm_session_dev=${token}` },
    });
    expect(dentro.status).toBe(200);
    expect((await dentro.json()).segreto).toBe(42);
  });

  it("i percorsi dichiarati pubblici nel manifesto passano senza sessione", async () => {
    // /salute e POST / stanno in `pubblici`; il metodo conta: GET / no
    expect((await fetch(`${base}/plugins/eco/salute`)).status).toBe(200);
    expect((await fetch(`${base}/plugins/eco/`, { method: "POST", body: "x" })).status).toBe(200);
    expect((await fetch(`${base}/plugins/eco/`)).status).toBe(401);
  });

  it("presta al plugin l'autenticazione vera del core", async () => {
    const noto = await (
      await fetch(`${base}/plugins/eco/chi`, {
        headers: { cookie: `kancrm_session_dev=${token}` },
      })
    ).json();
    expect(noto.utente?.name).toBe("Prova Eco");
    expect(noto.utente?.role).toBe("MEMBER");
  });

  it("consegna i corpi POST intatti, senza parser di mezzo", async () => {
    const r = await (
      await fetch(`${base}/plugins/eco/eco`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `kancrm_session_dev=${token}` },
        body: '{"grezzo":true}',
      })
    ).json();
    expect(r.corpo).toBe('{"grezzo":true}');
  });

  it("serve gli statici del plugin", async () => {
    const r = await fetch(`${base}/plugins/eco/`, {
      headers: { cookie: `kancrm_session_dev=${token}` },
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("pagina eco");
  });

  it("senza barra finale: il browser è reindirizzato, il protocollo è servito", async () => {
    const browser = await fetch(`${base}/plugins/eco`, {
      redirect: "manual",
      headers: { accept: "text/html", cookie: `kancrm_session_dev=${token}` },
    });
    expect(browser.status).toBe(308);
    expect(browser.headers.get("location")).toBe("/plugins/eco/");
    // un connettore MCP POSTa sull'indirizzo incollato, senza barra e senza
    // seguire i redirect: deve arrivare al plugin (Claude riceveva 404)
    const post = await fetch(`${base}/plugins/eco`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"da":"connettore"}',
    });
    expect(post.status).toBe(200);
    expect((await post.json()).corpo).toBe('{"da":"connettore"}');
  });

  it("espone la forma per inserzione dei metadati OAuth (RFC 8414)", async () => {
    const r = await (
      await fetch(`${base}/.well-known/oauth-authorization-server/plugins/eco`)
    ).json();
    expect(r.issuer).toContain("/plugins/eco");
  });

  it("espone le voci UI dei plugin montati, ancore comprese", async () => {
    const r = await (
      await fetch(`${base}/api/plugins/ui`, {
        headers: { cookie: `kancrm_session_dev=${token}` },
      })
    ).json();
    const eco = r.plugins.find((p: { nome: string }) => p.nome === "eco");
    expect(eco?.voce).toBe("Eco");
    expect(eco?.anchors?.project).toBe(true);
  });

  it("nomi malformati o mancanti non impediscono l'avvio", async () => {
    // se siamo arrivati fin qui l'app è su, nonostante "nome non valido!" e "fantasma"
    const r = await fetch(`${base}/plugins/fantasma/x`);
    expect([200, 404]).toContain(r.status); // risponde il core (SPA o 404)
  });
});

/**
 * **Il contratto delle tabelle dei plugin** (05/09/2026), provato per intero
 * nel server vero: la configurazione con le due versioni, la migrazione a
 * passi, il cancello del prefisso in scrittura E in lettura travestita, il
 * rifiuto di un plugin riportato indietro, la voce di menù validata.
 */
describe("plugin montato con un altro nome", () => {
  it("risponde sul nome del manifesto, non su quello della cartella, e riceve ctx.google", async () => {
    const r = await fetch(`${base}/plugins/eco-bis/salute`);
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as {
      montato: string;
      google: string[] | null;
      edizione: string;
      funzioni: string[];
      timesheet: unknown;
    };
    expect(corpo.montato).toContain("/plugins/eco-bis");
    // The credentials come from the commercial `google` module: none in the community.
    expect(corpo.google).toEqual(community ? null : ["clientId", "clientSecret", "enabled"]);
    // L'edizione e le sue funzioni (08/10/2026); la porta delle ore solo a chi la chiede.
    if (community) {
      expect(corpo.edizione).toBe("community");
      expect(corpo.funzioni).not.toContain("ticket");
    } else {
      expect(corpo.edizione).toBe("commerciale");
      expect(corpo.funzioni).toEqual(
        expect.arrayContaining(["ticket", "timesheet", "indice-modelli"]),
      );
    }
    expect(corpo.timesheet).toBeNull();
    // sul nome della cartella non c'è niente: risponde la SPA, non il plugin
    const vecchio = await fetch(`${base}/plugins/sostituto/salute`);
    expect(vecchio.headers.get("content-type") ?? "").not.toContain("application/json");
  });
});

describe("plugin con tabelle proprie", () => {
  const conSessione = { headers: { cookie: `kancrm_session_dev=${token}` } };

  it("al caricamento crea la configurazione, migra a passi e scrive le due versioni", async () => {
    const r = await (await fetch(`${base}/plugins/magazzino/versioni`, conSessione)).json();
    expect(r).toEqual({ plugin: "1.2.3", schema: "2", nick: "magazzino" });
    // e la tabella dice la sua: entrambi i passi sono passati (la colonna del 2 c'è)
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const colonne = db.prepare("PRAGMA table_info(plugin_magazzino_scaffale)").all() as Array<{
      name: string;
    }>;
    db.close();
    expect(colonne.map((c) => c.name)).toEqual(["id", "nome", "note"]);
  });

  it("scrive nelle proprie tabelle, e rilegge quello che ha scritto", async () => {
    const r = await (
      await fetch(`${base}/plugins/magazzino/scrivi`, { method: "POST", ...conSessione })
    ).json();
    expect(r.changes).toBe(1);
    expect(r.righe).toEqual([{ id: "s1", nome: "primo" }]);
  });

  it("una scrittura sul core si ferma al cancello, e dice quale tabella", async () => {
    const r = await (
      await fetch(`${base}/plugins/magazzino/sabota`, { method: "POST", ...conSessione })
    ).json();
    expect(r.passato).toBe(false);
    expect(r.errore).toContain('"Task"');
    // e il Task di prova non c'è più? No: c'è ancora — non c'era nemmeno prima,
    // ma la tabella esiste e la si può contare
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT count(*) AS n FROM Task").get()).toBeDefined();
    db.close();
  });

  it("una lettura travestita (WITH … DELETE) non passa nemmeno da all()", async () => {
    const r = await (
      await fetch(`${base}/plugins/magazzino/travestito`, { method: "POST", ...conSessione })
    ).json();
    expect(r.passato).toBe(false);
    expect(r.errore).toContain('"Task"');
  });

  it("un plugin riportato indietro non viene montato", async () => {
    // un percorso non montato lo prende il core (la SPA, 200): conta che non
    // risponda il plugin
    expect(await (await fetch(`${base}/plugins/avanti/ci-sei`)).text()).not.toBe("si");
    const ui = await (await fetch(`${base}/api/plugins/ui`, conSessione)).json();
    expect(ui.plugins.some((p: { nome: string }) => p.nome === "avanti")).toBe(false);
  });

  it("la voce di menù porta posizione, ruoli validati e le versioni", async () => {
    const ui = await (await fetch(`${base}/api/plugins/ui`, conSessione)).json();
    const m = ui.plugins.find((p: { nome: string }) => p.nome === "magazzino");
    expect(m).toMatchObject({
      sezione: "aree",
      dopo: "tasks",
      ruoli: ["MEMBER"], // MARZIANO scartato con un avviso
      soloManager: false,
      nick: "magazzino",
      versione: "1.2.3",
      schemaVersion: 2,
    });
    // il plugin senza nick non ha tabelle, e lo dice
    const eco = ui.plugins.find((p: { nome: string }) => p.nome === "eco");
    expect(eco.schemaVersion).toBeNull();
    expect(eco.sezione).toBe("aree");
    expect(eco.dopo).toBeNull();
  });
});

describe("accendere e spegnere un plugin da Sistema", () => {
  const conSessione = { headers: { cookie: `kancrm_session_dev=${token}` } };
  const daAdmin = (metodo = "GET", corpo?: unknown) => ({
    method: metodo,
    headers: {
      cookie: `kancrm_session_dev=${tokenAdmin}`,
      ...(corpo === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const accendi = (nome: string, attivo: boolean, sessione = daAdmin("PUT", { attivo })) =>
    fetch(`${base}/api/admin/plugins/${nome}`, sessione);

  it("Sistema elenca i plugin con versione, copyright, sommario e stato", async () => {
    const r = await fetch(`${base}/api/admin/system`, daAdmin());
    expect(r.status).toBe(200);
    const { plugins } = await r.json();
    expect(plugins.find((p: { nome: string }) => p.nome === "eco")).toMatchObject({
      titolo: "Eco di prova",
      versione: "0.0.1",
      copyright: "© 2026 Prova",
      licenza: "libero",
      sommario: { it: "Ripete.", en: "Echoes." },
      installato: true,
      attivo: true,
    });
    // presente ma non installato: il sommario ricade sulla prima frase della descrizione
    expect(plugins.find((p: { nome: string }) => p.nome === "dormiente")).toMatchObject({
      versione: "2.0.0",
      sommario: { it: "Dorme." },
      installato: false,
      motivo: null,
      attivo: false,
    });
    // in PLUGINS, ma chiede una funzione che qui non c'è: non montato, e si dice perché
    expect(plugins.find((p: { nome: string }) => p.nome === "esigente")).toMatchObject({
      installato: false,
      motivo: `richiede funzioni assenti in questa edizione: ${community ? "timesheet, " : ""}inesistente`,
    });
    expect(plugins.find((p: { nome: string }) => p.nome === "eco")?.motivo).toBeNull();
  });

  it("solo un amministratore accende e spegne", async () => {
    const r = await accendi("eco", false, {
      method: "PUT",
      headers: { ...conSessione.headers, "content-type": "application/json" },
      body: JSON.stringify({ attivo: false }),
    } as never);
    expect(r.status).toBe(403);
  });

  it("un plugin non installato non si accende da qui", async () => {
    expect((await accendi("dormiente", true)).status).toBe(409);
    expect((await accendi("inesistente", true)).status).toBe(404);
  });

  it("spento risponde 404 e sparisce dal menu; riacceso torna com'era", async () => {
    const spento = await accendi("eco", false);
    expect(spento.status).toBe(200);
    const elenco = (await spento.json()).plugins;
    expect(elenco.find((p: { nome: string }) => p.nome === "eco").attivo).toBe(false);

    const r = await fetch(`${base}/plugins/eco/salute`, { headers: { "x-locale": "en" } });
    expect(r.status).toBe(404);
    const corpo = await r.json();
    expect(corpo.error).toBe("PLUGIN_DISABLED");
    expect(corpo.message).toMatch(/disabled|turned off|switched off/i);
    const ui = await (await fetch(`${base}/api/plugins/ui`, conSessione)).json();
    expect(ui.plugins.some((p: { nome: string }) => p.nome === "eco")).toBe(false);
    expect(ui.plugins.some((p: { nome: string }) => p.nome === "magazzino")).toBe(true);

    expect((await accendi("eco", true)).status).toBe(200);
    expect((await fetch(`${base}/plugins/eco/salute`)).status).toBe(200);
    const ui2 = await (await fetch(`${base}/api/plugins/ui`, conSessione)).json();
    expect(ui2.plugins.some((p: { nome: string }) => p.nome === "eco")).toBe(true);
  });
});

describe("il tunnel fra plugin e il bottone nella barra", () => {
  const conSessione = { headers: { cookie: `kancrm_session_dev=${token}` } };
  const leggi = async (percorso: string) => (await fetch(`${base}${percorso}`, conSessione)).json();
  const accendi = (nome: string, attivo: boolean) =>
    fetch(`${base}/api/admin/plugins/${nome}`, {
      method: "PUT",
      headers: { cookie: `kancrm_session_dev=${tokenAdmin}`, "content-type": "application/json" },
      body: JSON.stringify({ attivo }),
    });

  it("chi chiede plugins:strumenti vede quelli degli altri, col prefisso e senza i propri", async () => {
    // «tunnel» si carica PRIMA di «eco»: il registro si legge alla chiamata, non all'avvio
    const { strumenti } = await leggi("/plugins/tunnel/elenco");
    expect(strumenti).toEqual([
      expect.objectContaining({ plugin: "eco", titolo: "Eco di prova", nome: "eco_saluta", descrizione: "Saluta la persona" }),
    ]);
  });

  it("l'identità la mette il core: un utente vero, o niente", async () => {
    const ok = await leggi("/plugins/tunnel/esegui?nome=eco_saluta&utente=utente-eco");
    expect(ok).toEqual({ ciao: "Prova Eco", ruolo: "MEMBER", come: "forte" });
    const falso = await leggi("/plugins/tunnel/esegui?nome=eco_saluta&utente=nessuno");
    expect(falso.errore).toMatch(/utente non valido/);
  });

  it("chi non ha il permesso non vede la porta degli strumenti; i segnali li hanno tutti", async () => {
    expect(await leggi("/plugins/eco/porte")).toEqual({ plugins: null, segnali: "function" });
  });

  it("un plugin spento sparisce anche dal tunnel", async () => {
    expect((await accendi("eco", false)).status).toBe(200);
    expect((await leggi("/plugins/tunnel/elenco")).strumenti).toEqual([]);
    expect((await accendi("eco", true)).status).toBe(200);
    expect((await leggi("/plugins/tunnel/elenco")).strumenti).toHaveLength(1);
  });

  it("il bottone nella barra arriva con gli indirizzi completi; chi non lo dichiara non ne ha", async () => {
    const ui = await leggi("/api/plugins/ui");
    const tunnel = ui.plugins.find((p: { nome: string }) => p.nome === "tunnel");
    expect(tunnel.barra).toEqual({
      icona: "segno.svg",
      iconaUrl: "/plugins/tunnel/segno.svg",
      statoUrl: "/plugins/tunnel/api/barra",
      pannelloUrl: "/plugins/tunnel/barra",
    });
    expect(ui.plugins.find((p: { nome: string }) => p.nome === "eco").barra).toBeNull();
  });
});
