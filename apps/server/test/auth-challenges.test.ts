import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("auth-challenges");

/**
 * Reset password self-service e accesso con codice email, provati per intero:
 * uniformità delle risposte (niente enumerazione), un solo uso, scadenze,
 * tentativi contati, sessioni chiuse al reset. Il mailer nei test è spento:
 * i segreti si pescano dal servizio, come farebbe l'email.
 */
const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const challenges = await import("../src/modules/auth/challenges");

let app: Awaited<ReturnType<typeof buildApp>>;
let utente: Awaited<ReturnType<typeof prisma.user.create>>;

const post = (url: string, body: unknown) =>
  app.inject({ method: "POST", url, payload: body as Record<string, unknown> });

beforeAll(async () => {
  app = await buildApp();
  utente = await prisma.user.create({
    data: { email: "sfida@test.local", name: "Utente Sfida", role: "MEMBER",
            isActive: true, passwordHash: "$argon2id$finto" },
  });
});

afterAll(async () => {
  await app.close();
});

describe("reset password self-service", () => {
  it("risponde uguale per chiunque: da fuori non si enumera nessuno", async () => {
    const esiste = await post("/api/auth/password-reset/request", { email: "sfida@test.local" });
    const ignoto = await post("/api/auth/password-reset/request", { email: "nessuno@test.local" });
    expect(esiste.statusCode).toBe(200);
    expect(ignoto.statusCode).toBe(200);
    expect(esiste.body).toBe(ignoto.body);
  });

  it("il token buono reimposta la password e chiude tutte le sessioni", async () => {
    await prisma.session.create({
      data: { id: randomBytes(16).toString("hex"), userId: utente.id,
              expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const token = await challenges.createResetChallenge(utente);
    const r = await post("/api/auth/password-reset/confirm",
      { token, password: "nuova-password-8" });
    expect(r.statusCode).toBe(200);
    const dopo = await prisma.user.findUniqueOrThrow({ where: { id: utente.id } });
    expect(dopo.passwordHash).not.toBe("$argon2id$finto");
    expect(dopo.passwordHash!.startsWith("$argon2id$")).toBe(true);
    expect(await prisma.session.count({ where: { userId: utente.id } })).toBe(0);
    // un solo uso: lo stesso token non vale due volte
    const riuso = await post("/api/auth/password-reset/confirm",
      { token, password: "altra-password-8" });
    expect(riuso.statusCode).toBe(401);
  });

  it("un token scaduto viene rifiutato", async () => {
    const token = await challenges.createResetChallenge(utente);
    await prisma.authChallenge.updateMany({
      where: { userId: utente.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await post("/api/auth/password-reset/confirm", { token, password: "password-123" });
    expect(r.statusCode).toBe(401);
  });
});

describe("accesso con codice via email", () => {
  it("il codice giusto apre una sessione", async () => {
    const code = await challenges.createOtpChallenge(utente);
    const r = await post("/api/auth/otp/verify", { email: "sfida@test.local", code });
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toBeDefined();
    expect(r.json().email).toBe("sfida@test.local");
    // un solo uso
    const riuso = await post("/api/auth/otp/verify", { email: "sfida@test.local", code });
    expect(riuso.statusCode).toBe(401);
  });

  it("cinque tentativi sbagliati uccidono la sfida, anche col codice giusto in mano", async () => {
    const code = await challenges.createOtpChallenge(utente);
    for (let i = 0; i < 5; i += 1) {
      const errato = await post("/api/auth/otp/verify",
        { email: "sfida@test.local", code: "000001" === code ? "000002" : "000001" });
      expect(errato.statusCode).toBe(401);
    }
    const dopo = await post("/api/auth/otp/verify", { email: "sfida@test.local", code });
    expect(dopo.statusCode).toBe(401);
  });

  it("il ritmo si tiene: una seconda richiesta entro un minuto non rigenera la sfida", async () => {
    await post("/api/auth/otp/request", { email: "sfida@test.local" });
    const prima = await prisma.authChallenge.findFirst({
      where: { userId: utente.id, type: "EMAIL_OTP" } });
    await post("/api/auth/otp/request", { email: "sfida@test.local" });
    const seconda = await prisma.authChallenge.findFirst({
      where: { userId: utente.id, type: "EMAIL_OTP" } });
    expect(seconda?.id).toBe(prima?.id);
  });

  it("la pulizia elimina solo le sfide scadute", async () => {
    await prisma.authChallenge.deleteMany({});
    await challenges.createOtpChallenge(utente);
    await prisma.authChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    const viva = await challenges.createResetChallenge(utente);
    expect(viva.length).toBeGreaterThan(20);
    const swept = await challenges.sweepExpiredChallenges();
    expect(swept).toBe(1);
    expect(await prisma.authChallenge.count()).toBe(1);
  });
});
