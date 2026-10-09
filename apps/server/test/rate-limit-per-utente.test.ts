import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

/**
 * V4: con una sessione valida le rotte che costano hanno un tetto per
 * persona. Qui la più economica da provare, il push di prova: cinque al
 * minuto, il sesto è 429 — e un'altra persona non è toccata.
 */
const { tempDir } = prepareTestDb("rate-limit-per-utente");
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");

let app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp();
  const passwordHash = await hashPassword("prova-1234");
  for (const email of ["uno@x.local", "due@x.local"]) {
    await prisma.user.create({ data: { email, name: email, role: UserRole.MEMBER, passwordHash } });
    const accesso = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "prova-1234" },
    });
    cookies[email] = accesso.headers["set-cookie"]!.toString().split(";")[0]!;
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("il tetto per persona", () => {
  it("il sesto push di prova in un minuto è 429, per quella persona sola", async () => {
    const prova = (email: string) =>
      app.inject({ method: "POST", url: "/api/push/test", headers: { cookie: cookies[email]! } });
    for (let i = 0; i < 5; i += 1) expect((await prova("uno@x.local")).statusCode).toBe(200);
    const sesto = await prova("uno@x.local");
    expect(sesto.statusCode).toBe(429);
    expect((await prova("due@x.local")).statusCode).toBe(200);
  });
});
