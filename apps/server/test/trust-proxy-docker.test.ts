// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

/**
 * **The proxy in another container** (09/10/2026). With Docker the TLS proxy
 * (Caddy) is not on 127.0.0.1 but on the compose network: `TRUST_PROXY=
 * loopback,uniquelocal` believes its `X-Forwarded-For`, so the login rate limit
 * counts each client and not the proxy. A peer outside the private networks
 * still cannot write its own address.
 */
const { tempDir } = prepareTestDb("trust-proxy-docker");
process.env.TRUST_PROXY = "loopback,uniquelocal";
const { buildApp } = await import("../src/app");
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("TRUST_PROXY per un proxy in un altro container", () => {
  let visto = "";
  const appPromise = buildApp().then((app) => {
    app.addHook("onRequest", (request, _reply, done) => {
      visto = request.ip;
      done();
    });
    return app;
  });
  afterAll(async () => (await appPromise).close());

  const ipVisto = async (remoteAddress: string, forwardedFor: string) => {
    const app = await appPromise;
    await app.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress,
      headers: { "x-forwarded-for": forwardedFor },
    });
    return visto;
  };

  it("dal proxy sulla rete privata vale l'indirizzo del client", async () => {
    expect(await ipVisto("172.18.0.3", "203.0.113.7")).toBe("203.0.113.7");
  });

  it("da un indirizzo pubblico l'intestazione non conta", async () => {
    expect(await ipVisto("198.51.100.20", "203.0.113.7")).toBe("198.51.100.20");
  });
});
