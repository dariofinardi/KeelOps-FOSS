// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("secret-comments");
process.env.SECRET_KEY_CRYPTO = "chiave-di-prova-per-i-test";

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const challenges = await import("../src/modules/auth/challenges");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie = "";
let taskId = "";
let userId = "";

beforeAll(async () => {
  await prisma.taskStatus.create({
    data: { name: "Da fare", category: "ADMIN", color: "#888", order: 0 },
  });
  const user = await prisma.user.create({
    data: {
      email: "riservato@test.local",
      name: "Rita Riservata",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      locale: "it",
      passwordHash: await hashPassword("rita12345"),
    },
  });
  userId = user.id;
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "riservato@test.local", password: "rita12345" },
  });
  cookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: { cookie },
    payload: { title: "Task con segreti" },
  });
  taskId = created.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const scrivi = (body: string) =>
  app.inject({
    method: "POST",
    url: `/api/tasks/${taskId}/comments`,
    headers: { cookie },
    payload: { body },
  });

describe("messaggi riservati (@secret)", () => {
  it("il corpo si cifra prima del database e non esce mai in chiaro", async () => {
    const r = await scrivi("@secret la password del cliente è Tremonti!44");
    expect(r.statusCode).toBe(201);
    const dto = r.json();
    expect(dto.secret).toBe(true);
    expect(dto.body).toBe("");

    // nel database: solo la busta cifrata, tre pezzi separati da punti
    const riga = await prisma.comment.findUniqueOrThrow({ where: { id: dto.id } });
    expect(riga.secret).toBe(true);
    expect(riga.body).not.toContain("Tremonti");
    expect(riga.body.split(".")).toHaveLength(3);

    // in elenco: stesso segnaposto vuoto
    const elenco = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/comments`,
      headers: { cookie },
    });
    const inLista = elenco.json().items.find((c: { id: string }) => c.id === dto.id);
    expect(inLista.secret).toBe(true);
    expect(inLista.body).toBe("");
  });

  it("la password giusta sblocca (senza il token), quella sbagliata no", async () => {
    const dto = (await scrivi("@secret il PIN della cassaforte è 8844")).json();
    const sbagliata = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments/${dto.id}/unlock`,
      headers: { cookie },
      payload: { method: "password", password: "non-e-questa" },
    });
    expect(sbagliata.statusCode).toBe(403);
    const giusta = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments/${dto.id}/unlock`,
      headers: { cookie },
      payload: { method: "password", password: "rita12345" },
    });
    expect(giusta.statusCode).toBe(200);
    expect(giusta.json().body).toBe("il PIN della cassaforte è 8844");
    // lo sblocco resta nello storico
    const traccia = await prisma.activityLog.findFirst({
      where: { taskId, action: "secret_unlocked", userId },
    });
    expect(traccia).not.toBeNull();
  });

  it("il codice via email sblocca, con la sfida dedicata", async () => {
    const dto = (await scrivi("@secret coordinate IBAN in arrivo")).json();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const code = await challenges.createOtpChallenge(user, challenges.ChallengeType.UNLOCK_OTP);
    const r = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments/${dto.id}/unlock`,
      headers: { cookie },
      payload: { method: "otp", code },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().body).toBe("coordinate IBAN in arrivo");
    // un codice di LOGIN non apre un messaggio: sfida diversa
    const loginCode = await challenges.createOtpChallenge(user);
    const conLogin = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments/${dto.id}/unlock`,
      headers: { cookie },
      payload: { method: "otp", code: loginCode },
    });
    expect(conLogin.statusCode).toBe(403);
  });

  it("un messaggio normale resta in chiaro e non si sblocca", async () => {
    const dto = (await scrivi("nota qualunque, visibile a tutti")).json();
    expect(dto.secret).toBe(false);
    expect(dto.body).toBe("nota qualunque, visibile a tutti");
    const r = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/comments/${dto.id}/unlock`,
      headers: { cookie },
      payload: { method: "password", password: "rita12345" },
    });
    expect(r.statusCode).toBe(404);
  });
});
