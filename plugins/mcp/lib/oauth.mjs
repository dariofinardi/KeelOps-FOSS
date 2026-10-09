/**
 * Self-contained OAuth 2.1 for the MCP server: dynamic client registration
 * (RFC 7591), authorization code with mandatory PKCE S256, rotating refresh
 * tokens. It is what Claude, ChatGPT and Mistral expect from a remote
 * connector.
 *
 * Consent asks for NO credentials: the user is recognized from the KeelOps
 * session (same origin). Every token belongs to THAT user, and every tool
 * call goes through their visibility perimeter.
 *
 * Tokens are stored as sha256 digests in data/oauth.json: reading the file
 * yields nothing spendable.
 */
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CODE_TTL = 10 * 60_000;            // ten minutes to exchange the code
const TOKEN_TTL = 8 * 3_600_000;         // eight hours of access
const REFRESH_TTL = 30 * 24 * 3_600_000; // thirty days of renewal

const hash = (s) => createHash("sha256").update(s).digest("hex");
const now = () => Date.now();

export class OAuthStore {
  constructor(file) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.data = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : { clients: {}, codes: {}, tokens: {}, refresh: {}, pending: {} };
  }

  #save() {
    // atomic write: never a half-written file if the process dies here
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  #sweep() {
    const t = now();
    for (const bag of ["codes", "tokens", "refresh", "pending"])
      for (const [k, v] of Object.entries(this.data[bag]))
        if (v.expiresAt < t) delete this.data[bag][k];
  }

  /* --- dynamic client registration (RFC 7591) --- */
  registerClient({ redirect_uris, client_name, token_endpoint_auth_method }) {
    if (!Array.isArray(redirect_uris) || !redirect_uris.length)
      throw new Error("redirect_uris is required");
    for (const uri of redirect_uris) {
      const u = new URL(uri); // must at least be a URL
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1")
        throw new Error("redirect_uri must be https (or localhost)");
    }
    const clientId = randomBytes(16).toString("hex");
    const method = token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none";
    const secret = method === "none" ? null : randomBytes(24).toString("hex");
    this.data.clients[clientId] = {
      redirectUris: redirect_uris, name: String(client_name ?? "client").slice(0, 120),
      authMethod: method, secretHash: secret ? hash(secret) : null, createdAt: now(),
    };
    this.#save();
    return { client_id: clientId, ...(secret ? { client_secret: secret } : {}),
             redirect_uris, token_endpoint_auth_method: method, client_name };
  }

  client(id) { return this.data.clients[id] ?? null; }

  /* --- the authorization request awaiting consent --- */
  savePending(params) {
    this.#sweep();
    const id = randomBytes(16).toString("hex");
    this.data.pending[id] = { ...params, expiresAt: now() + CODE_TTL };
    this.#save();
    return id;
  }
  /** Read a pending request WITHOUT consuming it: validation must not burn it. */
  peekPending(id) {
    const p = this.data.pending[id];
    return p && p.expiresAt > now() ? p : null;
  }
  takePending(id) {
    const p = this.data.pending[id];
    delete this.data.pending[id];
    this.#save();
    return p && p.expiresAt > now() ? p : null;
  }

  /* --- codes and tokens --- */
  newCode({ clientId, redirectUri, codeChallenge, userId, scope }) {
    const code = randomBytes(24).toString("hex");
    this.data.codes[hash(code)] = { clientId, redirectUri, codeChallenge, userId, scope,
                                    expiresAt: now() + CODE_TTL };
    this.#save();
    return code;
  }

  exchangeCode({ code, clientId, redirectUri, codeVerifier }) {
    this.#sweep();
    const key = hash(code);
    const c = this.data.codes[key];
    delete this.data.codes[key];           // a code is spent exactly once
    this.#save();
    if (!c || c.expiresAt < now()) throw new Error("code expired or unknown");
    if (c.clientId !== clientId) throw new Error("client differs from the one that requested the code");
    if (c.redirectUri !== redirectUri) throw new Error("redirect_uri mismatch");
    const challenge = createHash("sha256").update(codeVerifier ?? "").digest("base64url");
    if (challenge !== c.codeChallenge) throw new Error("PKCE verification failed");
    return this.#issueTokens(c.userId, clientId, c.scope);
  }

  #issueTokens(userId, clientId, scope) {
    const access = randomBytes(32).toString("hex");
    const refresh = randomBytes(32).toString("hex");
    this.data.tokens[hash(access)] = { userId, clientId, scope, expiresAt: now() + TOKEN_TTL };
    this.data.refresh[hash(refresh)] = { userId, clientId, scope, expiresAt: now() + REFRESH_TTL };
    this.#save();
    return { access_token: access, token_type: "Bearer",
             expires_in: Math.floor(TOKEN_TTL / 1000), refresh_token: refresh, scope };
  }

  refreshTokens({ refreshToken, clientId }) {
    this.#sweep();
    const key = hash(refreshToken);
    const r = this.data.refresh[key];
    delete this.data.refresh[key];         // rotation: the old one dies immediately
    this.#save();
    if (!r || r.expiresAt < now()) throw new Error("refresh token expired or unknown");
    if (r.clientId !== clientId) throw new Error("client mismatch");
    return this.#issueTokens(r.userId, r.clientId, r.scope);
  }

  /* --- established connections, seen per user --- */

  /** One row per client the user still holds live tokens with. */
  connectionsFor(userId) {
    this.#sweep();
    const seen = new Map();
    for (const bag of ["tokens", "refresh"])
      for (const v of Object.values(this.data[bag]))
        if (v.userId === userId && !seen.has(v.clientId))
          seen.set(v.clientId, {
            clientId: v.clientId,
            name: this.data.clients[v.clientId]?.name ?? v.clientId.slice(0, 8),
            createdAt: this.data.clients[v.clientId]?.createdAt ?? null,
          });
    return [...seen.values()];
  }

  /** Kill every token binding this user to this client. Returns how many died. */
  revokeConnection(userId, clientId) {
    let removed = 0;
    for (const bag of ["codes", "tokens", "refresh"])
      for (const [k, v] of Object.entries(this.data[bag]))
        if (v.userId === userId && v.clientId === clientId) { delete this.data[bag][k]; removed++; }
    if (removed) this.#save();
    return removed;
  }

  /**
   * RFC 7009: client-initiated revocation of a single token. Revoking a
   * refresh token also kills the sibling access tokens of the same grant,
   * as the RFC recommends. Unknown tokens are not an error, per spec.
   */
  revokeToken(token) {
    const key = hash(token ?? "");
    const r = this.data.refresh[key];
    if (r) {
      delete this.data.refresh[key];
      for (const [k, v] of Object.entries(this.data.tokens))
        if (v.userId === r.userId && v.clientId === r.clientId) delete this.data.tokens[k];
      return this.#save();
    }
    if (this.data.tokens[key]) { delete this.data.tokens[key]; this.#save(); }
  }

  verifyBearer(headerValue) {
    const m = /^Bearer\s+(.+)$/i.exec(headerValue ?? "");
    if (!m) return null;
    const t = this.data.tokens[hash(m[1].trim())];
    return t && t.expiresAt > now() ? { userId: t.userId, clientId: t.clientId ?? null, scope: t.scope } : null;
  }

  /** The name the client gave itself at registration («Claude», «ChatGPT»…): who is calling, for the pro's log. */
  clientName(clientId) {
    return (clientId && this.data.clients[clientId]?.name) || null;
  }
}
