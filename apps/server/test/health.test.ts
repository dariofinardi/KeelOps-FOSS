import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

// Its own throwaway database: buildApp reads and writes the signing secret,
// and without this the test would use data/app.db — the developer's, or none
// at all in a fresh clone.
const { tempDir } = prepareTestDb("health");
const { buildApp } = await import("../src/app");
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    await app.close();
  });

  it("returns JSON 401 for unknown api routes without a session", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("UNAUTHORIZED");
    await app.close();
  });
});
