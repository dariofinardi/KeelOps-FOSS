import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("company-by-name");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

/**
 * **Un'azienda per nome, una volta sola** (16/09/2026).
 *
 * «jugaad», «Jugaad» e «Jugaad srl» sono un cliente solo. Il vincolo del
 * database guarda il nome letterale e li lasciava passare tutti e tre: qui si
 * prova che ogni strada che crea un'azienda — il modulo, il «trova o crea» dei
 * moduli, la rinomina, l'importazione dei contatti — riconosce il doppione.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie = "";
let jugaadId = "";

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Ada Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      locale: "it",
      passwordHash: await hashPassword("admin1234"),
    },
  });
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "admin1234" },
  });
  cookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: { cookie, "x-locale": "it" }, payload });

describe("un'azienda per nome, una volta sola", () => {
  it("la prima si crea", async () => {
    const creata = await post("/api/companies", { name: "Jugaad" });
    expect(creata.statusCode).toBe(201);
    jugaadId = creata.json().id;
  });

  it("jugaad, JUGAAD e Jugaad S.r.l. sono doppioni, e il rifiuto dice quale c'è già", async () => {
    for (const nome of ["jugaad", "JUGAAD", "Jugaad srl", "Jugaad S.r.l."]) {
      const doppione = await post("/api/companies", { name: nome });
      expect(doppione.statusCode, nome).toBe(409);
      expect(doppione.json().message, nome).toContain("«Jugaad»");
    }
    expect(await prisma.company.count()).toBe(1);
  });

  it("trova o crea: il nome scritto diverso dà l'azienda che c'è, senza crearne", async () => {
    const trovata = await post("/api/companies/resolve", { name: "jugaad s.r.l." });
    expect(trovata.statusCode).toBe(200);
    expect(trovata.json()).toEqual({ id: jugaadId, name: "Jugaad", created: false });
    expect(await prisma.company.count()).toBe(1);
  });

  it("trova o crea: un nome nuovo la crea, ripulito dagli spazi", async () => {
    const nuova = await post("/api/companies/resolve", { name: "  Integro   SRL " });
    expect(nuova.statusCode).toBe(201);
    expect(nuova.json()).toMatchObject({ name: "Integro SRL", created: true });
    // Richiesta di nuovo, con un'altra grafia: è la stessa.
    const ancora = await post("/api/companies/resolve", { name: "integro" });
    expect(ancora.json()).toEqual({ id: nuova.json().id, name: "Integro SRL", created: false });
  });

  it("la tendina chiede se il nome c'è già", async () => {
    const chiedi = async (name: string) =>
      (
        await app.inject({
          method: "GET",
          url: `/api/companies/match?${new URLSearchParams({ name })}`,
          headers: { cookie },
        })
      ).json().company;
    expect(await chiedi("Jugaad S.p.A.")).toEqual({ id: jugaadId, name: "Jugaad" });
    expect(await chiedi("Jugaad Digital")).toBeNull();
    expect(await chiedi("")).toBeNull();
  });

  it("rinominare in un nome che è già di un'altra azienda è un doppione; restare sé stessa no", async () => {
    const integro = await prisma.company.findFirstOrThrow({ where: { name: "Integro SRL" } });
    const collide = await app.inject({
      method: "PATCH",
      url: `/api/companies/${integro.id}`,
      headers: { cookie, "x-locale": "it" },
      payload: { name: "JUGAAD srl" },
    });
    expect(collide.statusCode).toBe(409);
    // Cambiare solo la grafia del proprio nome è permesso: è la stessa azienda.
    const grafia = await app.inject({
      method: "PATCH",
      url: `/api/companies/${integro.id}`,
      headers: { cookie },
      payload: { name: "Integro S.r.l." },
    });
    expect(grafia.statusCode).toBe(200);
  });

  it("l'importazione dei contatti usa l'azienda che c'è anche se il file la scrive diversa", async () => {
    const csv = ["Nome,Cognome,Email,Azienda", "Roberto,Fadel,roberto@integrosrl.it,INTEGRO srl"].join("\n");
    const boundary = "----kancrmazienda";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="contatti.csv"`,
      "Content-Type: text/csv",
      "",
      csv,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const importati = await app.inject({
      method: "POST",
      url: "/api/contacts/import",
      headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(importati.statusCode).toBe(201);
    expect(importati.json()).toMatchObject({ imported: 1, companiesCreated: 0 });
    const contatto = await prisma.contact.findFirstOrThrow({ where: { email: "roberto@integrosrl.it" } });
    const integro = await prisma.company.findFirstOrThrow({ where: { name: "Integro S.r.l." } });
    expect(contatto.companyId).toBe(integro.id);
    expect(await prisma.company.count()).toBe(2);
  });
});
