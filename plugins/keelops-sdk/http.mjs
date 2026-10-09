/**
 * The plugins' HTTP engine: a route table, one dispatcher, and two ways to
 * serve it — inside the core (side-loaded, the production mode) or as a
 * standalone process (handy in development and in the self-tests).
 * No framework: the standard library is enough and plugins stay dependency-free.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml",
               ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".png": "image/png", ".json": "application/json; charset=utf-8" };

export function json(res, status, body, headers = {}) {
  const out = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(out);
}

export function html(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

export async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

/**
 * routes: a list of [method, regexp, handler(req, res, match, url)].
 * The dispatcher is the ONLY routing logic: side-loaded and standalone modes
 * both go through it, so they cannot diverge.
 *
 * @returns {(req, res, pathWithQuery) => Promise<void>}
 */
export function createDispatcher({ routes, staticDir, name }) {
  return async function dispatch(req, res, pathWithQuery) {
    const url = new URL(pathWithQuery, "http://plugin.local");
    try {
      for (const [method, pattern, handler] of routes) {
        if (req.method !== method) continue;
        const match = url.pathname.match(pattern);
        if (match) return await handler(req, res, match, url);
      }
      if (req.method === "GET" && staticDir) {
        const clean = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
        if (!clean.includes("..")) {
          const file = join(staticDir, clean);
          if (existsSync(file)) {
            res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
            return res.end(readFileSync(file));
          }
        }
      }
      json(res, 404, { errore: "non trovato" });
    } catch (err) {
      // never log bodies or tokens: the message only
      console.error(`[${name}] ${req.method} ${url.pathname}: ${err.message}`);
      if (!res.headersSent) json(res, 500, { errore: "errore interno" });
    }
  };
}

/** Standalone mode: an HTTP server invoking the very same dispatcher. */
export function startServer({ port, routes, staticDir, name }) {
  const dispatch = createDispatcher({ routes, staticDir, name });
  const server = createServer((req, res) => dispatch(req, res, req.url ?? "/"));
  server.listen(port, "127.0.0.1", () => console.log(`[${name}] listening on 127.0.0.1:${port}`));
  return server;
}
