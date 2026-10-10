// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

/**
 * **The community has no Google** (08/10/2026): sign-in with Google, the Drive
 * picker and the Drive preview are the commercial `google` module. Even with
 * the Google keys in the environment — a `.env` copied from a commercial
 * installation — nothing is offered, no route answers, and the CSP does not
 * open to Google's domains. Drive links stay links.
 */
const { tempDir } = prepareTestDb("edition-google-community");
process.env.KEELOPS_EDITION = "community";
process.env.NODE_ENV = "production";
process.env.GOOGLE_CLIENT_ID = "client-di-prova";
process.env.GOOGLE_CLIENT_SECRET = "segreto-di-prova";
process.env.GOOGLE_API_KEY = "chiave-di-prova";
process.env.GOOGLE_APP_ID = "123";
const { buildApp } = await import("../src/app");
const app = await buildApp();
afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});
const locale = { remoteAddress: "127.0.0.1" };

describe("Google nella community", () => {
  it("la pagina di accesso non offre né Google né il selettore Drive", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/providers", ...locale });
    expect(r.json().google).toEqual({
      sso: false,
      picker: { enabled: false, clientId: "", apiKey: "", appId: "" },
    });
  });

  it("le rotte dell'accesso con Google non esistono", async () => {
    for (const url of ["/api/auth/google/start", "/api/auth/google/callback?code=x&state=y"]) {
      const r = await app.inject({ method: "GET", url, ...locale });
      expect(r.statusCode, url).not.toBe(302);
      expect([401, 404], url).toContain(r.statusCode);
    }
  });

  it("la CSP non nomina Google", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health", ...locale });
    expect(String(r.headers["content-security-policy"])).not.toMatch(/google/);
  });
});
