// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live self-test of the MCP plugin: the full OAuth dance (dynamic
 * registration, consent with the KeelOps session, PKCE, code exchange,
 * refresh) and then the MCP protocol with the perimeter check: a member's
 * token must NOT see other people's deals or hours.
 *
 * `node selftest.mjs <copy-of-db>` — never against the real database.
 */
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error("usage: node selftest.mjs <copy-of-db>"); process.exit(1); }
const PORT = 5398, BASE = `http://127.0.0.1:${PORT}`;

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
/**
 * Two probes read BEFORE closing: any task with assignee and supervisor both
 * set and different, and any support request. The checks further down compare
 * the tools' answers against these rows.
 */
const conRuoli = db.prepare(`
  SELECT t.id, COALESCE(ua.nickName, ua.name) AS assegnatario,
         COALESCE(us.nickName, us.name) AS supervisore,
         COALESCE(uc.nickName, uc.name) AS creatore
  FROM Task t
  JOIN User ua ON ua.id = t.assigneeId
  JOIN User us ON us.id = t.supervisorId
  JOIN User uc ON uc.id = t.creatorId
  WHERE t.assigneeId <> t.supervisorId AND t.deletedAt IS NULL
  LIMIT 1`).get();
const oreVere = (userId) =>
  db.prepare(`SELECT ROUND(COALESCE(SUM(hours), 0), 1) AS ore FROM TimeEntry
              WHERE userId = ? AND date(date) BETWEEN '2026-07-01' AND '2026-07-31'`)
    .get(userId).ore;
const oreAdminLuglio = oreVere(admin.id);
const oreMembroLuglio = oreVere(member.id);
const cambioVero = db.prepare(`
  SELECT a.taskId, json_extract(a.payload, '$.to') AS stato_dopo
  FROM ActivityLog a JOIN Task t ON t.id = a.taskId
  WHERE a.action = 'status_changed' AND t.deletedAt IS NULL
  ORDER BY a.createdAt DESC LIMIT 1`).get();
const richiesta = db.prepare(`
  SELECT t.id FROM Task t
  WHERE (t.kind = 'TICKET' OR t.createdViaTicket = 1) AND t.deletedAt IS NULL
  LIMIT 1`).get();
// A lost deal with its reason written down: the tools must say WHY (31/08/2026).
const persaVera = db.prepare(`
  SELECT t.id, t.lostReason AS motivo, ds.name AS fase, co.name AS azienda,
         (SELECT COUNT(*) FROM ActivityLog a WHERE a.taskId = t.id AND a.action = 'stage_changed') AS passaggi
  FROM Task t JOIN DealStage ds ON ds.id = t.dealStageId
  LEFT JOIN Company co ON co.id = t.companyId
  WHERE t.kind = 'DEAL' AND ds.isLost = 1 AND t.deletedAt IS NULL
    AND t.lostReason IS NOT NULL AND TRIM(t.lostReason) <> ''
  ORDER BY t.closedAt DESC LIMIT 1`).get();
// Analysis tools (31/08/2026): the admin's totals must equal plain SQL on the copy.
const taskTotali = db.prepare(`SELECT COUNT(*) AS n FROM Task t WHERE t.deletedAt IS NULL`).get().n;
const richiesteTotali = db.prepare(`
  SELECT COUNT(*) AS n FROM Task t WHERE t.deletedAt IS NULL AND (t.kind = 'TICKET' OR t.createdViaTicket = 1)`).get().n;
const progettoVero = db.prepare(`
  SELECT p.id, p.name, (SELECT COUNT(*) FROM Task t WHERE t.projectId = p.id AND t.deletedAt IS NULL) AS task
  FROM Project p WHERE p.deletedAt IS NULL ORDER BY task DESC LIMIT 1`).get();
const perseTotali = db.prepare(`
  SELECT COUNT(*) AS n FROM Task t JOIN DealStage ds ON ds.id = t.dealStageId
  WHERE t.kind = 'DEAL' AND ds.isLost = 1 AND t.deletedAt IS NULL`).get().n;
db.close();
const db2 = new DatabaseSync(DB_PATH, { readOnly: true });

const server = spawn(process.execPath, [join(HERE, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), KEELOPS_DB: DB_PATH,
         MCP_PUBLIC_URL: BASE, KEELOPS_URL: "https://crm.example", SESSION_COOKIE: "kancrm_session" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise((ok) => server.stdout.on("data", (d) => { if (String(d).includes("listening on")) ok(); }));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); if (!cond) failures += 1; };

/** the full OAuth dance for one user, the way Claude would do it */
async function authorize(person) {
  const reg = await (await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Prova assistente", redirect_uris: ["http://localhost:9/cb"] }),
  })).json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = `${BASE}/oauth/authorize?response_type=code&client_id=${reg.client_id}` +
    `&redirect_uri=${encodeURIComponent("http://localhost:9/cb")}&state=xyz` +
    `&code_challenge=${challenge}&code_challenge_method=S256&scope=keelops:read`;
  const consentHtml = await (await fetch(authUrl, { headers: { cookie: `kancrm_session=${person.sid}` } })).text();
  const pendingId = consentHtml.match(/name="richiesta" value="([^"]+)"/)?.[1];
  // Follow the form like a browser would: resolve its action against the page
  // URL. A relative "oauth/consenso" once doubled the segment (23/08/2026).
  const action = consentHtml.match(/<form method="post" action="([^"]+)"/)?.[1];
  const consentUrl = new URL(action, authUrl).href;
  if (!consentUrl.endsWith("/oauth/consenso")) throw new Error(`form action risolve male: ${consentUrl}`);
  // a probe WITHOUT the session cookie must not burn the pending request
  const anon = await fetch(consentUrl, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `richiesta=${pendingId}&decisione=autorizzo`,
  });
  if (anon.status !== 401) throw new Error(`consenso senza sessione: atteso 401, avuto ${anon.status}`);
  const consent = await fetch(consentUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `kancrm_session=${person.sid}` },
    body: `richiesta=${pendingId}&decisione=autorizzo`,
  });
  // no 302: form-action 'self' would block it in the browser — the answer is
  // a bridge page whose meta refresh carries the callback URL
  if (consent.status !== 200) throw new Error(`consenso: atteso 200, avuto ${consent.status}`);
  const bridge = await consent.text();
  const backHref = bridge.match(/content="0;url=([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!backHref) throw new Error("pagina-ponte senza destinazione");
  // the second click of a double click: clear page, no crash
  const doubled = await fetch(consentUrl, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `kancrm_session=${person.sid}` },
    body: `richiesta=${pendingId}&decisione=autorizzo`,
  });
  if (doubled.status !== 400) throw new Error(`doppio consenso: atteso 400, avuto ${doubled.status}`);
  const back = new URL(backHref);
  const code = back.searchParams.get("code");
  const tokens = await (await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${code}&client_id=${reg.client_id}` +
      `&redirect_uri=${encodeURIComponent("http://localhost:9/cb")}&code_verifier=${verifier}`,
  })).json();
  return { reg, tokens, state: back.searchParams.get("state"), verifier, code };
}

const rpc = (token, method, params, id = 1) =>
  fetch(`${BASE}/`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).then((r) => r.json());
const callTool = async (token, name, args = {}) => {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  return JSON.parse(r.result.content[0].text);
};

try {
  const home = await (await fetch(`${BASE}/`, { headers: { accept: "text/html" } })).text();
  const probe = await fetch(`${BASE}/`, { headers: { accept: "text/event-stream" } });
  check("GET di protocollo sulla radice: 405 come da specifica", probe.status === 405);
  const homeIt = await (await fetch(`${BASE}/`,
    { headers: { accept: "text/html", "accept-language": "it" } })).text();
  const homeFr = await (await fetch(`${BASE}/`,
    { headers: { accept: "text/html", "accept-language": "fr" } })).text();
  check("la pagina è multilingua (it e fr dalla Accept-Language)",
        homeIt.includes("Collega un assistente") && homeFr.includes("Connecter un assistant"));
  const oidc = await (await fetch(`${BASE}/.well-known/openid-configuration`)).json();
  check("scoperta openid-configuration (la forma che alcuni client sondano)",
        oidc.issuer === BASE && oidc.token_endpoint === `${BASE}/oauth/token`);
  check("la pagina di istruzioni mostra l'indirizzo (la radice, senza /mcp doppio)",
        home.includes(`<code id="mcp-url">${BASE}</code>`) && home.includes('id="copy-btn"'));
  const meta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check("metadati OAuth (RFC 8414)", meta.registration_endpoint?.endsWith("/oauth/register") &&
        meta.code_challenge_methods_supported?.includes("S256"));
  check("i metadati dichiarano la revoca (RFC 7009)",
        meta.revocation_endpoint?.endsWith("/oauth/revoke"));
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  check("metadati risorsa (RFC 9728): la radice del plugin", prm.resource === BASE);
  const no = await fetch(`${BASE}/`, { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" });
  check("senza token: 401 con WWW-Authenticate", no.status === 401 &&
        (no.headers.get("www-authenticate") ?? "").includes("resource_metadata"));

  const a = await authorize(admin);
  check("registrazione dinamica del client", Boolean(a.reg.client_id));
  check("state restituito intatto", a.state === "xyz");
  check("token emesso col refresh", Boolean(a.tokens.access_token && a.tokens.refresh_token));

  // PKCE: a wrong verifier must be rejected
  const b = await authorize(member);
  const bad = await (await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${b.code}&client_id=${b.reg.client_id}` +
      `&redirect_uri=${encodeURIComponent("http://localhost:9/cb")}&code_verifier=SBAGLIATO`,
  })).json();
  check("codice già speso / PKCE sbagliato: rifiutato", bad.error === "invalid_grant");

  const init = await rpc(a.tokens.access_token, "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prova", version: "0" } });
  check("initialize negozia il protocollo", init.result.protocolVersion === "2025-06-18" &&
        init.result.serverInfo.name === "keelops-mcp");
  const init25 = await rpc(a.tokens.access_token, "initialize",
    { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "prova", version: "0" } });
  check("la revisione 2025-11-25 (quella delle icone) è accettata",
        init25.result.protocolVersion === "2025-11-25");
  check("consenso: 401 non brucia la richiesta, il doppio click riceve una pagina chiara", true);
  check("serverInfo dichiara l'icona KeelOps",
        init.result.serverInfo.icons?.[0]?.src?.endsWith("/keelops-icon.svg"));
  const iconRes = await fetch(init.result.serverInfo.icons[0].src.replace(/^.*\/plugins\/mcp/, BASE));
  check("l'icona è servita davvero", iconRes.status === 200 &&
        (await iconRes.text()).includes("<svg"));
  const tools = (await rpc(a.tokens.access_token, "tools/list")).result.tools;
  check(`tools/list: ${tools.map((t) => t.name).join(", ")}`,
        ["search", "fetch", "cerca_task", "progetti", "scadenze", "ore_per_progetto", "stato_offerte",
         "offerte", "dettaglio_offerta", "guida_dati", "statistiche_task", "dettaglio_progetto",
         "statistiche_richieste", "statistiche_ore", "aziende"]
          .every((n) => tools.some((t) => t.name === n)));

  const found = await callTool(a.tokens.access_token, "search", { query: "PDF" });
  check(`search trova (${found.results.length}) con id+title+url`,
        found.results.length > 0 && found.results.every((r) => r.id && r.title && r.url));
  const doc = await callTool(a.tokens.access_token, "fetch", { id: found.results[0].id });
  check("fetch riporta il documento", doc.id === found.results[0].id && typeof doc.text === "string");

  const hoursAdmin = await callTool(a.tokens.access_token, "ore_per_progetto",
    { da: "2026-07-01", a: "2026-08-01" });
  const hoursMember = await callTool(b.tokens.access_token, "ore_per_progetto",
    { da: "2026-07-01", a: "2026-08-01" });
  const sum = (x) => x.ore.reduce((s, r) => s + (r.ore ?? 0), 0);
  check(`ore: admin vede tutti (${sum(hoursAdmin)}h), il membro solo le sue (${sum(hoursMember)}h)`,
        hoursAdmin.di_chi === "tutti" && hoursMember.di_chi === "solo le mie" &&
        sum(hoursMember) <= sum(hoursAdmin));

  /**
   * The three roles under their own names, checked against the database: an
   * "assegnatario" that silently stood for supervisor or creator is exactly
   * the confusion the user warned about (26/08/2026). Data-driven: any task
   * of the copy with assignee and supervisor BOTH set and different will do.
   */
  if (conRuoli) {
    const dettaglio = await callTool(a.tokens.access_token, "fetch", { id: conRuoli.id });
    check("fetch distingue i tre ruoli (assegnatario ≠ supervisore, dal database)",
      dettaglio.metadata.assegnatario === conRuoli.assegnatario &&
      dettaglio.metadata.supervisore === conRuoli.supervisore &&
      dettaglio.metadata.creato_da === conRuoli.creatore &&
      dettaglio.metadata.assegnatario !== dettaglio.metadata.supervisore &&
      Array.isArray(dettaglio.metadata.miei_ruoli));
  } else {
    check("fetch distingue i tre ruoli (nessun task adatto nella copia)", true);
  }
  if (richiesta) {
    const dettaglio = await callTool(a.tokens.access_token, "fetch", { id: richiesta.id });
    check("una richiesta si dichiara tale (nata_da_ticket), qualunque sia il tipo",
      dettaglio.metadata.nata_da_ticket === true);
  } else {
    check("una richiesta si dichiara tale (nessuna nella copia)", true);
  }

  // Lo storico degli stati e il timesheet personale (26/08/2026): letture
  // nuove, provate contro le righe vere della copia.
  if (cambioVero) {
    const storia = await callTool(a.tokens.access_token, "storico_stati", { id: cambioVero.taskId });
    check("storico_stati di un task torna i cambi con da/a/di/quando",
      storia.cambi.length > 0 &&
      storia.cambi[0].a === cambioVero.stato_dopo &&
      typeof storia.cambi[0].quando === "string");
  } else {
    check("storico_stati (nessun cambio nella copia)", true);
  }
  const recenti = await callTool(a.tokens.access_token, "storico_stati", { giorni: 365 });
  check("storico_stati senza id resta sui task con un MIO ruolo",
    Array.isArray(recenti.cambi));
  // Ognuno riceve ESATTAMENTE le sue: i totali dello strumento devono
  // coincidere con la somma SQL per quell'utente, riga per riga plausibile.
  const mese = await callTool(a.tokens.access_token, "mio_timesheet",
    { da: "2026-07-01", a: "2026-07-31" });
  const membroMese = await callTool(b.tokens.access_token, "mio_timesheet",
    { da: "2026-07-01", a: "2026-07-31" });
  check(`mio_timesheet dell'admin = verità SQL (${oreAdminLuglio}h)`,
    mese.totale_ore === oreAdminLuglio &&
    mese.registrazioni.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.giorno) && r.task && r.ore > 0));
  check(`mio_timesheet del membro = verità SQL (${oreMembroLuglio}h), non quelle altrui`,
    membroMese.totale_ore === oreMembroLuglio);

  const dealsAdmin = await callTool(a.tokens.access_token, "stato_offerte");
  const dealsMember = await callTool(b.tokens.access_token, "stato_offerte");
  const count = (x) => x.fasi.reduce((s, r) => s + r.offerte, 0);
  check(`offerte: admin ${count(dealsAdmin)}, membro ${count(dealsMember)} (perimetro)`,
        count(dealsMember) <= count(dealsAdmin));

  // The deals, enriched (31/08/2026): outcome, money, customer and — for the
  // lost ones — the reason, in the pipeline summary, in the list and in the
  // single deal, all checked against the copy.
  check(`stato_offerte spiega le perdite: ${dealsAdmin.perse.offerte} perse, ${dealsAdmin.perse.motivi.length} motivi, vittoria ${dealsAdmin.tasso_vittoria}%`,
        dealsAdmin.perse.offerte === perseTotali && Array.isArray(dealsAdmin.perse.motivi) &&
        dealsAdmin.perse.motivi.every((m) => typeof m.motivo === "string" && m.offerte > 0) &&
        dealsAdmin.fasi.every((f) => ["aperta", "vinta", "persa"].includes(f.esito)));
  const perse = await callTool(a.tokens.access_token, "offerte", { esito: "perse" });
  check(`offerte(perse) elenca ${perse.offerte.length} offerte con esito e motivo`,
        perse.offerte.length === Math.min(perseTotali, 50) &&
        perse.offerte.every((o) => o.esito === "persa" && "motivo_perdita" in o && "azienda" in o));
  const aperte = await callTool(a.tokens.access_token, "offerte", {});
  check("offerte() di default sono le aperte, senza motivo di perdita",
        aperte.offerte.every((o) => o.esito === "aperta" && o.motivo_perdita === null));
  if (persaVera) {
    const una = await callTool(a.tokens.access_token, "dettaglio_offerta", { id: persaVera.id });
    check("dettaglio_offerta di una persa: motivo, fase, azienda e storia dei passaggi dal database",
          una.esito === "persa" && una.motivo_perdita === persaVera.motivo &&
          una.fase === persaVera.fase && una.azienda === persaVera.azienda &&
          una.storia_fasi.length === persaVera.passaggi &&
          una.storia_fasi.every((s) => "da" in s && "a" in s && "motivo" in s && "quando" in s) &&
          Array.isArray(una.messaggi) && Array.isArray(una.task_collegati));
    const inLista = await callTool(a.tokens.access_token, "cerca_task", {});
    check("cerca_task riporta il blocco offerta sui record DEAL",
          inLista.task.filter((t) => t.tipo === "DEAL").every((t) => t.offerta && "esito" in t.offerta));
    const documento = await callTool(a.tokens.access_token, "fetch", { id: persaVera.id });
    check("fetch di un'offerta porta i dati commerciali nei metadati",
          documento.metadata.offerta?.motivo_perdita === persaVera.motivo);
  } else {
    check("dettaglio_offerta (nessuna offerta persa con motivo nella copia)", true);
  }
  // Every kind of data, aggregated for analysis (31/08/2026).
  const guida = await callTool(a.tokens.access_token, "guida_dati");
  check("guida_dati spiega i dati", typeof guida.guida === "string" && /perimetro/i.test(guida.guida));
  const st = await callTool(a.tokens.access_token, "statistiche_task", { giorni: 365 });
  check(`statistiche_task: totale ${st.totale} = SQL ${taskTotali}, ${st.aperti} aperti, ${st.in_ritardo} in ritardo, ${st.per_mese.length} mesi`,
        st.totale === taskTotali && st.aperti + st.chiusi === st.totale &&
        st.per_tipo.length > 0 && st.per_stato.length > 0 && st.per_assegnatario.length > 0 &&
        st.per_mese.every((m) => /^\d{4}-\d{2}$/.test(m.mese)) && st.piu_vecchi_aperti.length <= 5);
  const sr = await callTool(a.tokens.access_token, "statistiche_richieste", { giorni: 365 });
  check(`statistiche_richieste: ${sr.totale} = SQL ${richiesteTotali}, per priorità ${sr.per_priorita.length}, richiedenti ${sr.per_richiedente.length}`,
        sr.totale === richiesteTotali && Array.isArray(sr.per_priorita) && Array.isArray(sr.per_progetto));
  if (progettoVero) {
    const dp = await callTool(a.tokens.access_token, "dettaglio_progetto", { progetto: progettoVero.name });
    check(`dettaglio_progetto("${progettoVero.name.slice(0, 20)}…"): ${dp.task.totale} task = SQL ${progettoVero.task}, ${dp.ore.ore}h`,
          dp.id === progettoVero.id && dp.task.totale === progettoVero.task &&
          Array.isArray(dp.membri) && dp.ore.di_chi === "tutti" && Array.isArray(dp.ore.per_persona));
  } else {
    check("dettaglio_progetto (nessun progetto nella copia)", true);
  }
  const orePersona = await callTool(b.tokens.access_token, "statistiche_ore",
    { da: "2026-07-01", a: "2026-07-31", raggruppa: "persona" });
  check(`statistiche_ore del membro per persona: solo se stesso (${orePersona.righe.length} riga, ${orePersona.totale_ore}h)`,
        orePersona.di_chi === "solo le mie" && orePersona.righe.length <= 1 && orePersona.totale_ore === oreMembroLuglio);
  const oreMese = await callTool(a.tokens.access_token, "statistiche_ore",
    { da: "2026-01-01", a: "2026-12-31", raggruppa: "mese" });
  check(`statistiche_ore per mese: ${oreMese.righe.length} mesi con media ore/giornata`,
        oreMese.righe.every((r) => /^\d{4}-\d{2}$/.test(r.chiave) && r.giornate > 0 && r.media_ore_giornata > 0));
  const az = await callTool(a.tokens.access_token, "aziende", {});
  check(`aziende: ${az.aziende.length} con offerte e progetti`,
        az.aziende.length > 0 && az.aziende.every((c) => c.offerte && "vinte" in c.offerte && "progetti" in c));
  check("stato_offerte porta andamento mensile, aziende e pipeline pesata",
        Array.isArray(dealsAdmin.per_mese) && Array.isArray(dealsAdmin.per_azienda) &&
        typeof dealsAdmin.aperte.valore_pesato === "number");

  const perseMembro = await callTool(b.tokens.access_token, "offerte", { esito: "tutte" });
  check("offerte del membro: solo nel suo perimetro",
        perseMembro.offerte.length <= (await callTool(a.tokens.access_token, "offerte", { esito: "tutte" })).offerte.length);

  // ---- record tools (05/09/2026): everything readable about one thing ----
  const elenco = await rpc(a.tokens.access_token, "tools/list", {});
  const nomi = elenco.result.tools.map((t) => t.name);
  check("gli strumenti di record ci sono tutti",
        ["dettaglio_task", "allegati_task", "leggi_allegato", "richieste", "messaggi", "cerca_contatti",
         "dettaglio_azienda", "persone", "mie_notifiche", "ricorrenze", "tag", "mie_bacheche"].every((n) => nomi.includes(n)));
  const unTask = db2.prepare(`SELECT id FROM Task t WHERE t.deletedAt IS NULL ORDER BY t.updatedAt DESC LIMIT 1`).get();
  const dettaglio = await callTool(a.tokens.access_token, "dettaglio_task", { id: unTask.id });
  check("dettaglio_task porta storico, messaggi, allegati, ore e tag",
        dettaglio.id === unTask.id && Array.isArray(dettaglio.storico) && Array.isArray(dettaglio.messaggi)
        && Array.isArray(dettaglio.allegati) && typeof dettaglio.ore?.totale === "number" && Array.isArray(dettaglio.tag));
  const richiesteR = await callTool(a.tokens.access_token, "richieste", { stato: "tutte" });
  check("richieste: tante quante nella copia (ammin.)", richiesteR.richieste.length === Math.min(richiesteTotali, 50));
  const msg = await callTool(a.tokens.access_token, "messaggi", { id: unTask.id });
  check("messaggi di un task: elenco (anche vuoto), mai riservati", Array.isArray(msg.messaggi));
  const rubrica = await callTool(a.tokens.access_token, "cerca_contatti", {});
  check("cerca_contatti: contatti e aziende", Array.isArray(rubrica.contatti) && Array.isArray(rubrica.aziende));
  if (rubrica.aziende[0]) {
    const az = await callTool(a.tokens.access_token, "dettaglio_azienda", { id: rubrica.aziende[0].id });
    check("dettaglio_azienda: contatti, offerte, progetti, note", az.nome === rubrica.aziende[0].nome
          && Array.isArray(az.contatti) && Array.isArray(az.offerte) && Array.isArray(az.progetti) && Array.isArray(az.note_crm));
  }
  const gente = await callTool(a.tokens.access_token, "persone", {});
  check("persone: solo interni, e io mi riconosco", gente.persone.every((p) => ["ADMIN", "MEMBER"].includes(p.ruolo))
        && gente.persone.some((p) => p.sono_io));
  const notifiche = await callTool(a.tokens.access_token, "mie_notifiche", { solo_non_lette: false, giorni: 90 });
  check("mie_notifiche: elenco con conteggio non lette", Array.isArray(notifiche.notifiche) && typeof notifiche.non_lette === "number");
  const ric = await callTool(a.tokens.access_token, "ricorrenze", { solo_attive: false });
  check("ricorrenze: regola e prossima scadenza", Array.isArray(ric.ricorrenze) && ric.ricorrenze.every((r) => typeof r.regola === "string"));
  const tagR = await callTool(a.tokens.access_token, "tag", {});
  check("tag: elenco con task aperti", Array.isArray(tagR.tag));
  const bacheche = await callTool(a.tokens.access_token, "mie_bacheche", {});
  check("mie_bacheche risponde (anche senza l'estensione)", typeof bacheche.disponibile === "boolean");
  const allegatiR = await callTool(a.tokens.access_token, "allegati_task", { id: unTask.id });
  check("allegati_task: elenco con id per leggi_allegato", Array.isArray(allegatiR.allegati));
  const conLink = db2.prepare(`SELECT ta.taskId FROM TaskAttachment ta JOIN Attachment at ON at.id = ta.attachmentId JOIN Task t ON t.id = ta.taskId
                               WHERE at.type = 'LINK' AND t.deletedAt IS NULL LIMIT 1`).get();
  if (conLink) {
    const elencoLink = await callTool(a.tokens.access_token, "allegati_task", { id: conLink.taskId });
    check("un collegamento dice che serve il connettore autorizzato dell'assistente",
          elencoLink.allegati.some((x) => x.tipo === "collegamento" && /connettore/.test(x.nota ?? "")));
  }
  const lettura = await rpc(a.tokens.access_token, "tools/call", { name: "leggi_allegato", arguments: { id: "x" } });
  check("leggi_allegato fuori dal core dice che non può", lettura.result.isError === true && /fuori dal core/.test(lettura.result.content[0].text));
  const modelli = await rpc(a.tokens.access_token, "resources/templates/list", {});
  check("le risorse dichiarano il modello keelops://allegato/{id}", modelli.result.resourceTemplates[0].uriTemplate === "keelops://allegato/{id}");
  // the member: a task outside their perimeter is invisible in detail too
  const altrui = db2.prepare(`SELECT t.id FROM Task t WHERE t.kind = 'DEAL' AND t.deletedAt IS NULL AND t.creatorId <> ? AND (t.assigneeId IS NULL OR t.assigneeId <> ?) LIMIT 1`).get(member.id, member.id);
  if (altrui) {
    const negato = await rpc(b.tokens.access_token, "tools/call", { name: "dettaglio_task", arguments: { id: altrui.id } });
    check("dettaglio_task del membro su un'offerta altrui: rifiutato", negato.result.isError === true);
  }

  const refreshed = await (await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${a.tokens.refresh_token}&client_id=${a.reg.client_id}`,
  })).json();
  check("refresh a rotazione emette un token nuovo", Boolean(refreshed.access_token) &&
        refreshed.access_token !== a.tokens.access_token);
  const again = await (await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${a.tokens.refresh_token}&client_id=${a.reg.client_id}`,
  })).json();
  check("il refresh vecchio è morto", again.error === "invalid_grant");

  // il vecchio percorso /mcp resta vivo per i connettori già configurati
  const note = await fetch(`${BASE}/mcp`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${refreshed.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  check("le notifiche ricevono 202", note.status === 202);

  // the instructions page lists the live connection and its Revoca button
  const pageHtml = await (await fetch(`${BASE}/`, {
    headers: { accept: "text/html", cookie: `kancrm_session=${admin.sid}` } })).text();
  check("la pagina elenca la connessione attiva",
        pageHtml.includes("Connessioni attive") && pageHtml.includes(a.reg.client_id));
  const revoked = await fetch(`${BASE}/oauth/revoca`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `kancrm_session=${admin.sid}` },
    body: `cliente=${a.reg.client_id}`,
  });
  check("il bottone Revoca risponde col ritorno alla pagina", revoked.status === 303);
  const deadTool = await fetch(`${BASE}/`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${refreshed.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }) });
  check("dopo la revoca il token è morto", deadTool.status === 401);
  const emptyPage = await (await fetch(`${BASE}/`, {
    headers: { accept: "text/html", cookie: `kancrm_session=${admin.sid}` } })).text();
  check("revocata, la connessione sparisce dall'elenco", !emptyPage.includes(a.reg.client_id));

  // RFC 7009: revoking the refresh token kills the sibling access token too
  const rfc = await fetch(`${BASE}/oauth/revoke`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `token=${b.tokens.refresh_token}`,
  });
  const deadMember = await fetch(`${BASE}/`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${b.tokens.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "ping" }) });
  check("RFC 7009: revocato il refresh, muore anche l'access", rfc.status === 200 && deadMember.status === 401);
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} PROVE FALLITE` : "\ntutte le prove passano");
process.exit(failures ? 1 : 0);
