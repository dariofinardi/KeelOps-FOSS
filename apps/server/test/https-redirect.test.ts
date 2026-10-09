import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { hostWithoutPort, shouldRedirectToHttps } from "../src/lib/https-redirect";
import { prepareTestDb } from "./support/test-db";

// Its own throwaway database: buildApp reads and writes the signing secret,
// and without this the test would use data/app.db — the developer's, or none
// at all in a fresh clone.
const { tempDir } = prepareTestDb("https-redirect");
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const EXTERNAL = "192.168.196.42";

describe("shouldRedirectToHttps", () => {
  it("manda su HTTPS chi apre l'indirizzo in chiaro dall'esterno", () => {
    expect(shouldRedirectToHttps({ host: "192.168.196.100:5103" }, EXTERNAL)).toBe(true);
  });

  it("non tocca ciò che arriva dal proxy: è già servito in sicurezza", () => {
    // nginx parla in chiaro col backend ma inoltra lo schema originale: senza
    // questo controllo ogni richiesta rimbalzerebbe all'infinito.
    expect(
      shouldRedirectToHttps({ host: "kancrm", "x-forwarded-proto": "https" }, "127.0.0.1"),
    ).toBe(false);
    // Catena di proxy: conta il primo valore.
    expect(shouldRedirectToHttps({ "x-forwarded-proto": "https, http" }, EXTERNAL)).toBe(false);
    expect(shouldRedirectToHttps({ "x-forwarded-proto": ["https"] }, EXTERNAL)).toBe(false);
  });

  it("non tocca le chiamate locali (proxy e controllo di salute del deploy)", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(shouldRedirectToHttps({ host: "127.0.0.1:5103" }, ip)).toBe(false);
    }
  });

  it("redirige se il proxy dichiara http (accesso in chiaro attraverso il proxy)", () => {
    expect(shouldRedirectToHttps({ "x-forwarded-proto": "http" }, EXTERNAL)).toBe(true);
  });
});

describe("hostWithoutPort", () => {
  it("toglie la porta e regge nomi, IP e IPv6", () => {
    expect(hostWithoutPort("192.168.196.100:5103")).toBe("192.168.196.100");
    expect(hostWithoutPort("kancrm.local:5103")).toBe("kancrm.local");
    expect(hostWithoutPort("kancrm")).toBe("kancrm");
    expect(hostWithoutPort("[::1]:5103")).toBe("[::1]");
    expect(hostWithoutPort(undefined)).toBe("localhost");
  });
});

/**
 * Prova sull'app reale: in produzione il redirect dev'essere attivo per chi arriva
 * dall'esterno in chiaro, ma non deve toccare il proxy né il controllo di salute
 * che il deploy interroga su 127.0.0.1 (altrimenti ogni deploy fallirebbe).
 */
describe("redirect nell'app (produzione)", () => {
  const withProdEnv = async (run: () => Promise<void>) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    // config legge NODE_ENV all'import: serve un modulo fresco.
    vi.resetModules();
    try {
      await run();
    } finally {
      process.env.NODE_ENV = previous;
      vi.resetModules();
    }
  };

  it("chi arriva dall'esterno in chiaro viene mandato su HTTPS 5443", async () => {
    await withProdEnv(async () => {
      const { buildApp } = await import("../src/app");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/personale",
        headers: { host: "192.168.196.100:5103" },
        remoteAddress: "192.168.196.42",
      });
      expect(res.statusCode).toBe(308);
      expect(res.headers.location).toBe("https://192.168.196.100:5443/personale");
      await app.close();
    });
    // Questi due casi costruiscono l'app intera da zero (moduli ricaricati per
    // rileggere NODE_ENV): con la macchina occupata dal resto del controllo non
    // ci stanno nei 5 secondi di default, e fallivano senza che ci fosse niente
    // di rotto.
  }, 20_000);

  it("il controllo di salute in locale continua a rispondere", async () => {
    await withProdEnv(async () => {
      const { buildApp } = await import("../src/app");
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { host: "127.0.0.1:5103" },
        remoteAddress: "127.0.0.1",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
      await app.close();
    });
    // Questi due casi costruiscono l'app intera da zero (moduli ricaricati per
    // rileggere NODE_ENV): con la macchina occupata dal resto del controllo non
    // ci stanno nei 5 secondi di default, e fallivano senza che ci fosse niente
    // di rotto.
  }, 20_000);
});
