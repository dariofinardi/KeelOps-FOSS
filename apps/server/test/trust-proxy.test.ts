import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

// Its own throwaway database: buildApp reads and writes the signing secret,
// and without this the test would use data/app.db — the developer's, or none
// at all in a fresh clone.
const { tempDir } = prepareTestDb("trust-proxy");
const { buildApp } = await import("../src/app");
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

/**
 * **Di chi ci si fida per l'indirizzo del chiamante.**
 *
 * Il TLS lo fa nginx sulla stessa macchina: senza `trustProxy` ogni richiesta
 * risultava arrivare da 127.0.0.1, e il rate limit del login — che conta i
 * tentativi per indirizzo — aveva un secchio unico per tutta l'utenza: dieci
 * password sbagliate di chiunque bloccavano il login a tutti (22/08/2026).
 *
 * La fiducia però vale **solo per il proxy locale**: la porta HTTP del processo
 * è raggiungibile anche direttamente dalla rete, e un `X-Forwarded-For` scritto
 * dal client non deve contare niente — o il rate limit si aggira con un header.
 */
describe("trustProxy: l'indirizzo del chiamante", () => {
  // Il gancio va montato PRIMA che l'app parta: dopo, Fastify li rifiuta.
  let visto = "";
  const appPromise = buildApp().then((app) => {
    app.addHook("onRequest", (request, _reply, done) => {
      visto = request.ip;
      done();
    });
    return app;
  });
  afterAll(async () => (await appPromise).close());

  const ipVisto = async (opzioni: { remoteAddress: string; forwardedFor?: string }) => {
    const app = await appPromise;
    // La rotta di salute è pubblica e non ha effetti: perfetta per leggere
    // come il server ha risolto l'indirizzo.
    await app.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: opzioni.remoteAddress,
      headers: opzioni.forwardedFor ? { "x-forwarded-for": opzioni.forwardedFor } : {},
    });
    return visto;
  };

  it("dal proxy locale vale l'X-Forwarded-For: è il client vero", async () => {
    expect(await ipVisto({ remoteAddress: "127.0.0.1", forwardedFor: "203.0.113.7" })).toBe(
      "203.0.113.7",
    );
  });

  it("da chiunque altro l'header non conta: resta l'indirizzo del peer", async () => {
    // Un client della LAN che arriva diretto sulla porta HTTP e si inventa un
    // X-Forwarded-For non deve poter svuotare il rate limit né sporcare i log.
    expect(await ipVisto({ remoteAddress: "192.168.196.42", forwardedFor: "203.0.113.7" })).toBe(
      "192.168.196.42",
    );
  });
});
