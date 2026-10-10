// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The MCP server routes, independent of HOW the plugin is served: the core
 * uses them when the plugin is side-loaded, `server.mjs` in standalone mode.
 *
 * ctx: { db, store, version, keelopsUrl, publicUrl, uiDir, sessionUser(req) } —
 * `sessionUser` may be async (in the core it is: it goes through Prisma).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { json, html, readJson, readBody } from "../../keelops-sdk/http.mjs";
import { BASE_CSS, CARD_CSS, ICONS } from "../../keelops-sdk/ui.mjs";
import { escapeHtml } from "../../keelops-sdk/text.mjs";
import { buildTools } from "./tools.mjs";
import { ha, offribile } from "./edizione.mjs";
import { pageLocale, translate } from "./i18n.mjs";

const SCOPE = "keelops:read";
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];


export function buildRoutes(ctx) {
  // The pro plugin replaces the tool set (filter, Drive, extraction) and adds
  // to the instructions: `ctx.strumenti(db, user, keelopsUrl, attachments)`
  // and `ctx.istruzioni` are its hooks; the base runs without them.
  const strumenti = ctx.strumenti ?? buildTools;
  const logo = readFileSync(join(ctx.uiDir, "mcp-chiaro.svg"), "utf8");
  const logoDark = readFileSync(join(ctx.uiDir, "mcp-scuro.svg"), "utf8");
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

async function userById(id) {
  const u = await ctx.db.get(`SELECT id, name, nickName, role, isActive, canViewAllTimesheets
                        FROM User WHERE id = ?`, id);
  if (!u || !u.isActive || (u.role !== "ADMIN" && u.role !== "MEMBER")) return null;
  return { id: u.id, name: u.nickName || u.name, role: u.role,
           canViewAllTimesheets: u.canViewAllTimesheets,
           // what this core has (see edizione.mjs); absent = everything
           ...(ctx.funzioni ? { funzioni: new Set(ctx.funzioni) } : {}) };
}

/* ------------------------------ pages ------------------------------ */

function instructionsPage({ mcpUrl, user, logo, logoDark, locale, connections = [], revokeUrl, extra = "", notaEdizione = null }) {
  const t = (key, params) => translate(locale, key, params);
  const esc = escapeHtml;
  const step = (title, body) =>
    `<li><strong>${esc(title)}</strong><span>${body}</span></li>`;
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("Interfaccia MCP"))} · KeelOps MCP</title>
<style>${BASE_CSS}
body{margin:0;background:var(--carta);color:var(--inchiostro);font:15px/1.65 system-ui,sans-serif;
  padding:clamp(1.2rem,4vw,3rem)}
.foglio{max-width:44rem;margin:0 auto;display:flex;flex-direction:column;gap:1.6rem}
.logo svg{height:1.8rem;width:auto;max-width:100%}
h1{font-size:1.5rem;margin:.4rem 0 0}
h2{font-size:1.05rem;margin:0 0 .5rem}
p{margin:.4rem 0;color:var(--tenue)} p strong,li strong{color:var(--inchiostro)}
.scheda{background:var(--rilievo);border:1px solid var(--filo);border-radius:.7rem;
  padding:1.2rem 1.4rem;box-shadow:0 4px 16px rgba(0,0,0,.06)}
.url{display:flex;gap:.6rem;align-items:center;margin:.6rem 0}
.url code{flex:1;font-family:ui-monospace,monospace;font-size:.95rem;background:var(--accento-fondo);
  border:1px solid var(--filo);border-radius:.5rem;padding:.6em .9em;word-break:break-all}
button{font:inherit;font-weight:600;padding:.55em 1em;border-radius:.5rem;cursor:pointer;
  background:var(--accento);color:var(--carta);border:0;white-space:nowrap}
ol{margin:.4rem 0;padding-left:1.2rem;display:flex;flex-direction:column;gap:.5rem}
li span{display:block;color:var(--tenue);font-size:.92rem}
ul{margin:.4rem 0;padding-left:1.2rem;color:var(--tenue);font-size:.92rem}
.strumenti{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.strumenti code{background:var(--accento-fondo);border-radius:.35rem;padding:.15em .5em;font-size:.85rem}
.nota{font-size:.85rem;color:var(--tenue)}
.connessioni{list-style:none;margin:.4rem 0 0;padding:0;display:flex;flex-direction:column;gap:.55rem}
.connessioni li{display:flex;align-items:center;justify-content:space-between;gap:1rem;
  border:1px solid var(--filo);border-radius:.5rem;padding:.5rem .8rem}
.connessioni form{margin:0}
.connessioni button{background:transparent;color:var(--accento);border:1px solid var(--filo)}
</style><script src="sdk/tema.js" defer></script></head><body><div class="foglio">
<header>
  <div class="logo"><span class="logo-chiaro">${logo}</span><span class="logo-scuro">${logoDark}</span></div>
  <h1>${esc(t("Collega un assistente AI a KeelOps"))}</h1>
  <p>${t("Claude, ChatGPT e Mistral possono {leggere} KeelOps attraverso questo connettore MCP: nessuno strumento scrive, e ogni assistente vede solo ciò che vede {chi} — il suo perimetro, mai quello degli altri.",
    { leggere: `<strong>${esc(t("leggere"))}</strong>`,
      chi: `<strong>${user ? esc(user.name) : esc(t("l'utente che lo autorizza"))}</strong>` })}</p>
</header>

<section class="scheda">
  <h2>${esc(t("L'indirizzo da incollare"))}</h2>
  <div class="url"><code id="mcp-url">${esc(mcpUrl)}</code>
    <button type="button" id="copy-btn" data-copied="${esc(t("Copiato"))}">${ICONS.copia}<span>${esc(t("Copia"))}</span></button>
  </div>
  <p class="nota">${user
    ? t("Sei dentro come {nome}: autorizzando un assistente, leggerà come te.", { nome: `<strong>${esc(user.name)}</strong>` })
    : esc(t("Non risulti dentro KeelOps da questo browser: accedi prima al gestionale, il consenso ne avrà bisogno."))}</p>
</section>

<section class="scheda">
  <h2>${esc(t("Dove si incolla"))}</h2>
  <ol>
    ${step("Claude (claude.ai / Desktop)", t("Settings → Connectors → {voce} → incolla l'indirizzo.", { voce: "<em>Add custom connector</em>" }))}
    ${step("ChatGPT", t("Settings → Connectors (serve la Developer mode, piani a pagamento) → incolla l'indirizzo."))}
    ${step("Mistral Le Chat", t("Intelligence → Connectors → {voce} → incolla l'indirizzo.", { voce: "<em>Add MCP connector</em>" }))}
  </ol>
  <p class="nota">${esc(t("Il provider scopre da sé la configurazione OAuth, si registra da solo e apre la pagina di consenso di KeelOps: lì serve una sessione attiva in questo browser. Da quel momento l'assistente usa un suo token, revocabile, che vale otto ore e si rinnova da sé."))}</p>
</section>

${connections.length ? `<section class="scheda">
  <h2>${esc(t("Connessioni attive"))}</h2>
  <p class="nota">${esc(t("Revocare spegne subito i token dell'assistente: per ricollegarlo si rifà l'autorizzazione dall'app."))}</p>
  <ul class="connessioni">${connections.map((c) => `
    <li><span><strong>${esc(c.name)}</strong>${c.createdAt
        ? ` <span class="nota">· ${esc(t("autorizzato il {quando}", { quando: new Date(c.createdAt).toLocaleDateString(locale) }))}</span>` : ""}</span>
      <form method="post" action="${esc(revokeUrl)}"><input type="hidden" name="cliente" value="${esc(c.clientId)}">
      <button>${ICONS.revoca}<span>${esc(t("Revoca"))}</span></button></form></li>`).join("")}
  </ul>
</section>` : ""}
${extra}
<section class="scheda">
  <h2>${esc(t("Cosa può fare, e cosa no"))}</h2>
  <ul>
    <li>${t("solo {lettura}: nessuno strumento modifica nulla;", { lettura: `<strong>${esc(t("lettura"))}</strong>` })}</li>
    <li>${t("risponde nel {perimetro} che ha autorizzato: le offerte altrui e le ore degli altri restano fuori;", { perimetro: `<strong>${esc(t("perimetro dell'utente"))}</strong>` })}</li>
    <li>${notaEdizione ?? t("questa è la versione {base}: i testi arrivano all'assistente così come sono. Per i client non fidati è previsto il plugin con pseudonimizzazione.", { base: `<strong>${esc(t("base"))}</strong>` })}</li>
  </ul>
  <div class="strumenti">
    <code>search</code><code>fetch</code><code>cerca_task</code><code>progetti</code>
    <code>scadenze</code><code>storico_stati</code><code>mio_timesheet</code>
    <code>ore_per_progetto</code><code>stato_offerte</code>
  </div>
</section>
</div><script src="copy.js" defer></script></body></html>`;
}

/** A styled notice for the OAuth pages: the bare <p> errors looked broken. */
function noticePage({ locale, title, body, backHref }) {
  const t = (key, params) => translate(locale, key, params);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t(title))} · KeelOps MCP</title>
<style>${BASE_CSS}${CARD_CSS}
h1{margin-top:0}
</style><script src="sdk/tema.js" defer></script></head><body><div class="scheda">
<h1>${escapeHtml(t(title))}</h1>
<p>${escapeHtml(t(body))}</p>
${backHref ? `<p><a href="${escapeHtml(backHref)}">${ICONS.indietro}${escapeHtml(t("Torna alle istruzioni"))}</a></p>` : ""}
</div></body></html>`;
}

/**
 * The bridge back to the assistant. The consent form CANNOT answer with a
 * 302: the core CSP says `form-action 'self'` and Chrome checks the redirect
 * destination of a form submission against it, so the hop to claude.ai (or
 * chatgpt.com, or mistral.ai) is silently blocked — the click "does nothing"
 * (seen live, 23/08/2026). A meta refresh is a navigation, not a form action,
 * and the CSP lets it through; the link is the fallback.
 */
function returnPage({ locale, href }) {
  const t = (key, params) => translate(locale, key, params);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${escapeHtml(href)}">
<title>${escapeHtml(t("Torno all'assistente…"))} · KeelOps MCP</title>
<style>${BASE_CSS}${CARD_CSS}
h1{margin-top:0}
</style><script src="sdk/tema.js" defer></script></head><body><div class="scheda">
<h1>${escapeHtml(t("Torno all'assistente…"))}</h1>
<p><a href="${escapeHtml(href)}">${escapeHtml(t("Se non succede nulla, continua da qui."))}</a></p>
</div></body></html>`;
}

function consentPage({ pendingId, client, user, locale }) {
  const t = (key, params) => translate(locale, key, params);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t("Autorizza"))} · KeelOps MCP</title>
<style>${BASE_CSS}${CARD_CSS}
ul{color:var(--tenue);padding-left:1.2rem;font-size:.9rem}
.azioni{display:flex;gap:.6rem;margin-top:1.3rem}
button{flex:1;font:inherit;font-weight:600;padding:.55em 1em;border-radius:.5rem;cursor:pointer}
.si{background:var(--accento);color:var(--carta);border:0}
.no{background:none;color:var(--inchiostro);border:1.5px solid var(--filo)}
</style><script src="sdk/tema.js" defer></script></head><body><div class="scheda">
<div class="logo"><span class="logo-chiaro">${logo}</span><span class="logo-scuro">${logoDark}</span></div>
<h1>${escapeHtml(t("Collegare un assistente a KeelOps?"))}</h1>
<p>${t("{client} chiede di leggere KeelOps come {nome}.",
  { client: `<strong>${escapeHtml(client.name)}</strong>`,
    nome: `<strong>${escapeHtml(user.name)}</strong>` })}</p>
<ul>
  <li>${escapeHtml(t("solo lettura: nessuno strumento scrive;"))}</li>
  <li>${escapeHtml(t("vedrà solo ciò che vedi tu: il tuo perimetro, non quello degli altri;"))}</li>
  <li>${escapeHtml(t("revocabile in ogni momento da «Connessioni attive» nella pagina Interfaccia MCP."))}</li>
</ul>
<form method="post" action="consenso"><input type="hidden" name="richiesta" value="${escapeHtml(pendingId)}">
<div class="azioni">
  <button class="no" name="decisione" value="nego">${ICONS.nega}<span>${escapeHtml(t("Nega"))}</span></button>
  <button class="si" name="decisione" value="autorizzo" data-wait="${escapeHtml(t("Un attimo…"))}">${ICONS.conferma}<span>${escapeHtml(t("Autorizza"))}</span></button>
</div></form></div><script src="../consent.js" defer></script></body></html>`;
}

function loginNeededPage(locale) {
  const t = (key) => translate(locale, key);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t("Serve una sessione KeelOps"))} · KeelOps MCP</title>
<style>${BASE_CSS}${CARD_CSS}</style>
<script src="sdk/tema.js" defer></script></head><body><div class="scheda">
<div class="logo"><span class="logo-chiaro">${logo}</span><span class="logo-scuro">${logoDark}</span></div>
<h1>${escapeHtml(t("Serve una sessione KeelOps"))}</h1>
<p>${escapeHtml(t("Il consenso riconosce l'utente dal cookie di KeelOps: accedi prima al gestionale in questa stessa finestra, poi torna indietro e riprova."))}</p>
${ctx.keelopsUrl ? `<p><a href="${escapeHtml(ctx.keelopsUrl)}/login">${ICONS.entra}${escapeHtml(t("Vai all'accesso di KeelOps"))}</a></p>` : ""}
</div></body></html>`;
}

/* ------------------------------ MCP ------------------------------ */

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] };
}

async function handleRpc(message, user) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, msg) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      // the pro's addition may depend on the user (its privacy filter is per person)
      const extra = typeof ctx.istruzioni === "function" ? await ctx.istruzioni(user) : ctx.istruzioni;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: {
          name: "keelops-mcp", title: "KeelOps", version: ctx.version,
          websiteUrl: ctx.keelopsUrl,
          icons: [{ src: `${ctx.publicUrl}/keelops-icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
        },
        instructions: `Strumenti in sola lettura sul gestionale KeelOps, dentro il perimetro dell'utente ${user.name}. Le risposte sono JSON in italiano. Per orientarsi: guida_dati. Per trovare: search/cerca_task, offerte, ${ha(user, "ticket") ? "richieste, " : ""}cerca_contatti, persone. Per approfondire UN record: dettaglio_task, dettaglio_offerta, dettaglio_azienda, dettaglio_progetto. I documenti allegati si leggono con leggi_allegato (id da allegati_task/dettaglio_task); la chat con messaggi; le proprie cose con mio_timesheet, mie_notifiche, mie_bacheche.${extra ? ` ${extra}` : ""}`,
      });
    }
    case "ping": return reply({});
    case "tools/list":
      return reply({ tools: strumenti(ctx.db, user, ctx.keelopsUrl, ctx.attachments ?? null)
        .filter((tool) => offribile(tool, user))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = strumenti(ctx.db, user, ctx.keelopsUrl, ctx.attachments ?? null).find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `strumento sconosciuto: ${params?.name}`);
      // hidden from the list in this edition, but called by name anyway
      if (!offribile(tool, user)) {
        return reply({ content: [{ type: "text", text: `Errore: ${tool.name} non è disponibile in questa edizione di KeelOps` }], isError: true });
      }
      try {
        const out = await tool.run(params.arguments ?? {});
        // a tool that builds its own MCP content (the attachments: text plus the file)
        return reply(Array.isArray(out?.mcpContent) ? { content: out.mcpContent } : toolResult(out));
      } catch (err) {
        return reply({ content: [{ type: "text", text: `Errore: ${err.message}` }], isError: true });
      }
    }
    /**
     * Resources (05/09/2026): the attachments, addressable as
     * `keelops://allegato/<id>` — the same thing `leggi_allegato` returns, for
     * clients that prefer resources to tools. No listing: the list would be the
     * whole store, and the ids come from the tools anyway.
     */
    case "resources/list": return reply({ resources: [] });
    case "resources/templates/list":
      return reply({ resourceTemplates: [{ uriTemplate: "keelops://allegato/{id}", name: "Allegato di KeelOps",
        description: "Un allegato (file o collegamento) di un task, con il testo estratto; l'id viene da allegati_task o dettaglio_task." }] });
    case "resources/read": {
      const m = /^keelops:\/\/allegato\/([^/]+)$/.exec(params?.uri ?? "");
      if (!m) return fail(-32602, `risorsa sconosciuta: ${params?.uri}`);
      if (!ctx.attachments) return fail(-32603, "lettura degli allegati non disponibile fuori dal core");
      try {
        const a = await ctx.attachments.read(user.id, m[1], { bytes: true });
        const contents = [];
        if (a.text) contents.push({ uri: params.uri, mimeType: "text/plain", text: a.text });
        if (a.bytes) contents.push({ uri: params.uri, mimeType: a.mimeType ?? "application/octet-stream", blob: a.bytes.toString("base64") });
        if (a.url) contents.push({ uri: params.uri, mimeType: "text/uri-list", text: a.url });
        if (contents.length === 0) contents.push({ uri: params.uri, mimeType: "text/plain", text: a.saltato ?? "(vuoto)" });
        return reply({ contents });
      } catch (err) {
        return fail(-32603, err.message);
      }
    }
    default:
      return method?.startsWith("notifications/") ? null : fail(-32601, `unhandled method: ${method}`);
  }
}

/* ------------------------------ routes ------------------------------ */

const wwwAuth = `Bearer resource_metadata="${ctx.publicUrl}/.well-known/oauth-protected-resource"`;

async function handleMcpPost(req, res) {
    const auth = ctx.store.verifyBearer(req.headers.authorization);
    const user = auth ? await userById(auth.userId) : null;
    if (!user)
      return json(res, 401, { error: "invalid_token" }, { ...CORS, "www-authenticate": wwwAuth });
    // which assistant is calling: the pro logs it (and warns it when the privacy filter changes)
    user.client = { id: auth.clientId, nome: ctx.store.clientName?.(auth.clientId) ?? null };
    const message = await readJson(req);
    if (Array.isArray(message)) {   // batch: answer whatever carries an id
      const replies = (await Promise.all(message.map((m) => handleRpc(m, user)))).filter(Boolean);
      return replies.length ? json(res, 200, replies, CORS) : (res.writeHead(202, CORS), res.end());
    }
    const reply = await handleRpc(message, user);
    if (!reply) { res.writeHead(202, CORS); return res.end(); }   // notification: accepted, nothing more
    json(res, 200, reply, CORS);
  }

  function authServerMetadata(res) {
    json(res, 200, {
      issuer: ctx.publicUrl,
      authorization_endpoint: `${ctx.publicUrl}/oauth/authorize`,
      token_endpoint: `${ctx.publicUrl}/oauth/token`,
      revocation_endpoint: `${ctx.publicUrl}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      registration_endpoint: `${ctx.publicUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: [SCOPE],
      // OIDC-shaped probes want these fields to exist, even if unused here
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    }, CORS);
  }

  return [
  ["OPTIONS", /^\/.*$/, (req, res) => { res.writeHead(204, CORS); res.end(); }],

  /**
   * The plugin's home page: plain instructions for connecting an assistant,
   * with THE url to paste. User-facing text is Italian, like the product UI.
   */
  ["GET", /^\/$/, async (req, res) => {
    // un browser chiede text/html e riceve le istruzioni; un client MCP che
    // sonda con GET (stream SSE non offerto) riceve il 405 previsto dalla specifica
    if (!String(req.headers.accept ?? "").includes("text/html")) {
      res.writeHead(405, { ...CORS, allow: "POST" });
      return res.end();
    }
    const user = await ctx.sessionUser(req);
    const locale = pageLocale(req, user);
    // the pro adds its panel (Drive, filter, settings) through this hook
    const pro = ctx.paginaExtra ? await ctx.paginaExtra({ req, user, locale }) : null;
    html(res, 200, instructionsPage({
      mcpUrl: ctx.publicUrl, user, logo, logoDark, locale,
      connections: user ? ctx.store.connectionsFor(user.id) : [],
      revokeUrl: `${ctx.publicUrl}/oauth/revoca`,
      extra: pro?.html ?? "", notaEdizione: pro?.notaEdizione ?? null,
    }));
  }],

  ["GET", /^\/health$/, (req, res) =>
    json(res, 200, { ok: true, plugin: "mcp", versione: ctx.version })],

  ["GET", /^\/\.well-known\/oauth-protected-resource(\/mcp)?$/, (req, res) =>
    json(res, 200, { resource: ctx.publicUrl, authorization_servers: [ctx.publicUrl],
                     scopes_supported: [SCOPE], bearer_methods_supported: ["header"] }, CORS)],

  // some clients (OpenAI included) probe the OIDC form of the same metadata
  ["GET", /^\/\.well-known\/openid-configuration$/, (req, res) => authServerMetadata(res)],
  ["GET", /^\/\.well-known\/oauth-authorization-server$/, (req, res) => authServerMetadata(res)],

  ["POST", /^\/oauth\/register$/, async (req, res) => {
    try { json(res, 201, ctx.store.registerClient(await readJson(req)), CORS); }
    catch (err) { json(res, 400, { error: "invalid_client_metadata", error_description: err.message }, CORS); }
  }],

  ["GET", /^\/oauth\/authorize$/, async (req, res, m, url) => {
    const q = url.searchParams;
    const client = ctx.store.client(q.get("client_id"));
    if (!client) return html(res, 400, noticePage({ locale: pageLocale(req, null),
      title: "Client sconosciuto",
      body: "L'assistente non risulta registrato: torna all'app e rilancia la connessione, si registrerà da sé.",
      backHref: `${ctx.publicUrl}/` }));
    const redirectUri = q.get("redirect_uri");
    if (!client.redirectUris.includes(redirectUri))
      return html(res, 400, noticePage({ locale: pageLocale(req, null),
        title: "Indirizzo di ritorno non registrato",
        body: "L'indirizzo di ritorno non corrisponde a quello registrato dall'assistente: rilancia la connessione dall'app.",
        backHref: `${ctx.publicUrl}/` }));
    const back = (err) => { const u = new URL(redirectUri);
      u.searchParams.set("error", err);
      if (q.get("state")) u.searchParams.set("state", q.get("state"));
      res.writeHead(302, { location: u.href }); res.end(); };
    if (q.get("response_type") !== "code") return back("unsupported_response_type");
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge"))
      return back("invalid_request");
    const user = await ctx.sessionUser(req);
    if (!user) return html(res, 401, loginNeededPage(pageLocale(req, null)));
    const pendingId = ctx.store.savePending({
      clientId: q.get("client_id"), redirectUri, codeChallenge: q.get("code_challenge"),
      state: q.get("state") ?? "", userId: user.id,
    });
    html(res, 200, consentPage({ pendingId, client, user, locale: pageLocale(req, user) }));
  }],

  ["POST", /^\/oauth\/consenso$/, async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    /**
     * Validate BEFORE consuming: a missing session must not burn the pending
     * request (log in, click again, it still works), and a double click gets
     * a clear page instead of a bare 400 (both seen live on 23/08/2026).
     */
    const pendingId = form.get("richiesta");
    const expired = () => html(res, 400, noticePage({ locale: pageLocale(req, null),
      title: "Richiesta scaduta",
      body: "Ogni richiesta di consenso vale pochi minuti e si usa una volta sola. Torna all'assistente e rilancia la connessione.",
      backHref: `${ctx.publicUrl}/` }));
    if (!ctx.store.peekPending(pendingId)) return expired();
    const user = await ctx.sessionUser(req);
    if (!user) return html(res, 401, loginNeededPage(pageLocale(req, user)));
    const pending = ctx.store.takePending(pendingId);
    if (!pending) return expired();          // consumed by a concurrent click
    if (user.id !== pending.userId) return html(res, 401, loginNeededPage(pageLocale(req, user)));
    const back = new URL(pending.redirectUri);
    if (pending.state) back.searchParams.set("state", pending.state);
    if (form.get("decisione") !== "autorizzo") back.searchParams.set("error", "access_denied");
    else back.searchParams.set("code", ctx.store.newCode({ ...pending, scope: SCOPE, userId: user.id }));
    html(res, 200, returnPage({ locale: pageLocale(req, user), href: back.href }));
  }],

  /**
   * The instructions page's "Revoca" button: kills every token binding the
   * signed-in user to that client. Session cookie only — never callable by
   * the assistant itself.
   */
  ["POST", /^\/oauth\/revoca$/, async (req, res) => {
    const user = await ctx.sessionUser(req);
    if (!user) return html(res, 401, loginNeededPage(pageLocale(req, null)));
    const form = new URLSearchParams(await readBody(req));
    ctx.store.revokeConnection(user.id, form.get("cliente") ?? "");
    res.writeHead(303, { location: `${ctx.publicUrl}/` });
    res.end();
  }],

  // RFC 7009: providers call this when the user disconnects on their side
  ["POST", /^\/oauth\/revoke$/, async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    ctx.store.revokeToken(form.get("token"));
    json(res, 200, {}, CORS);   // per spec, unknown tokens are 200 too
  }],

  ["POST", /^\/oauth\/token$/, async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    const clientId = form.get("client_id");
    const client = ctx.store.client(clientId);
    const deny = (code, description) =>
      json(res, 400, { error: code, error_description: description }, CORS);
    if (!client) return deny("invalid_client", "client sconosciuto");
    if (client.authMethod === "client_secret_post") {
      const secret = form.get("client_secret") ?? "";
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(secret).digest("hex") !== client.secretHash)
        return deny("invalid_client", "segreto errato");
    }
    try {
      if (form.get("grant_type") === "authorization_code")
        return json(res, 200, ctx.store.exchangeCode({
          code: form.get("code"), clientId,
          redirectUri: form.get("redirect_uri"), codeVerifier: form.get("code_verifier") }), CORS);
      if (form.get("grant_type") === "refresh_token")
        return json(res, 200, ctx.store.refreshTokens({
          refreshToken: form.get("refresh_token"), clientId }), CORS);
      deny("unsupported_grant_type", "solo authorization_code e refresh_token");
    } catch (err) { deny("invalid_grant", err.message); }
  }],

  ["POST", /^\/$/, handleMcpPost],
  ["DELETE", /^\/$/, (req, res) => { res.writeHead(200, CORS); res.end(); }],
  // il vecchio percorso /mcp resta per i connettori già configurati
  ["POST", /^\/mcp$/, handleMcpPost],

  // the streamable transport allows a server not to offer the GET stream
  ["GET", /^\/mcp$/, (req, res) => { res.writeHead(405, { ...CORS, allow: "POST" }); res.end(); }],
  ["DELETE", /^\/mcp$/, (req, res) => { res.writeHead(200, CORS); res.end(); }],
];


}
