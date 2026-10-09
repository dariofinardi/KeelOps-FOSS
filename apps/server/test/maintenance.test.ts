import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { fingiBuild } from "./support/finta-build";

prepareTestDb("maintenance");

/**
 * La modalità manutenzione, provata per intero: chi resta fuori, chi entra,
 * come si accende e si spegne, e la pagina di cortesia nella lingua giusta.
 */
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { invalidateMaintenanceCache } = await import("../src/modules/maintenance/service");

const publicDir = path.resolve(import.meta.dirname, "../public");
let app: Awaited<ReturnType<typeof buildApp>>;

const sessions: Record<string, string> = {};
async function mkUser(key: string, role: string, adminUntil: Date | null = null) {
  const user = await prisma.user.create({
    data: { email: `${key}@test.local`, name: `Utente ${key}`, role, isActive: true, adminUntil },
  });
  const token = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: { id: createHash("sha256").update(token).digest("hex"), userId: user.id,
            expiresAt: new Date(Date.now() + 3_600_000) },
  });
  sessions[key] = token;
}

const call = (pathname: string, key?: string, init: RequestInit = {}) =>
  app.inject({
    method: (init.method as "GET" | "POST") ?? "GET",
    url: pathname,
    headers: {
      ...(key ? { cookie: `kancrm_session_dev=${sessions[key]}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
    payload: init.body as string | undefined,
  });

const setState = (key: string, active: boolean, message?: string) =>
  call("/api/admin/maintenance", key, {
    method: "POST", body: JSON.stringify({ active, ...(message ? { message } : {}) }),
  });

let ripristina: () => void = () => undefined;

beforeAll(async () => {
  // la pagina finta, e quella vera rimessa a posto alla fine (support/finta-build)
  ripristina = fingiBuild(publicDir, "<!doctype html><title>spa</title>");
  app = await buildApp();
  await mkUser("member", "MEMBER");
  await mkUser("plainAdmin", "ADMIN");                                   // non elevato
  await mkUser("sudoAdmin", "ADMIN", new Date(Date.now() + 30 * 60_000)); // elevato
});

afterAll(async () => {
  await app.close();
  ripristina();
});

describe("la modalità manutenzione", () => {
  it("da spenta non cambia nulla", async () => {
    expect((await call("/api/tasks", "member")).statusCode).toBe(200);
    expect((await call("/", "member")).statusCode).toBe(200);
  });

  it("accenderla è roba da amministratore ELEVATO", async () => {
    expect((await setState("member", true)).statusCode).toBe(403);
    expect((await setState("plainAdmin", true)).statusCode).toBe(403); // sudo non attivo = MEMBER
    const on = await setState("sudoAdmin", true, "Torniamo alle 15");
    expect(on.statusCode).toBe(200);
    expect(on.json().active).toBe(true);
  });

  it("da accesa chiude fuori gli utenti: 503 JSON sulle API", async () => {
    invalidateMaintenanceCache();
    const r = await call("/api/tasks", "member");
    expect(r.statusCode).toBe(503);
    expect(r.json().maintenance).toBe(true);
    expect(r.json().message).toBe("Torniamo alle 15");
  });

  it("le pagine mostrano la cortesia, localizzata e col messaggio", async () => {
    const en = await call("/", "member", { headers: { "accept-language": "en-US" } });
    expect(en.statusCode).toBe(503);
    expect(en.body).toContain("We are down for maintenance");
    expect(en.body).toContain("Torniamo alle 15");
    const anon = await call("/", undefined, { headers: { "accept-language": "it" } });
    expect(anon.statusCode).toBe(503);
    expect(anon.body).toContain("Siamo in manutenzione");
  });

  it("la salute, lo stato e l'area auth restano aperti a tutti", async () => {
    expect((await call("/api/health")).statusCode).toBe(200);
    const state = await call("/api/maintenance");
    expect(state.statusCode).toBe(200);
    expect(state.json().active).toBe(true);
    expect((await call("/api/auth/me", "member")).statusCode).toBe(200);
  });

  it("un admin entra anche NON elevato: è lui che può riaprire", async () => {
    expect((await call("/api/tasks", "plainAdmin")).statusCode).toBe(200);
    expect((await call("/", "plainAdmin")).statusCode).toBe(200);
  });

  it("spenta, tutto torna come prima", async () => {
    expect((await setState("sudoAdmin", false)).statusCode).toBe(200);
    invalidateMaintenanceCache();
    expect((await call("/api/tasks", "member")).statusCode).toBe(200);
    expect((await call("/", "member")).statusCode).toBe(200);
    expect((await call("/api/maintenance")).json().active).toBe(false);
  });
});
