// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("richtextimg");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const PW = "password-di-prova-1";

let taskId = "";

const cookies = new Map<string, string>();
async function cookie(email: string): Promise<string> {
  const cached = cookies.get(email);
  if (cached) return cached;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PW },
  });
  const value = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const header = `${SESSION_COOKIE}=${value}`;
  cookies.set(email, header);
  return header;
}

/** Un PNG vero, minimo: il server accetta per tipo dichiarato e dimensione. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function multipart(buffer: Buffer, filename: string, contentType: string) {
  const boundary = "----prova";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const autore = await prisma.user.create({
    data: { email: "autore@x.local", name: "Autore", role: UserRole.ADMIN, adminUntil: new Date("2099-01-01"), passwordHash: hash },
  });
  // Un utente interno che con quel task non c'entra niente.
  await prisma.user.create({
    data: {
      email: "estraneo@x.local",
      name: "Estraneo",
      role: UserRole.MEMBER,
      passwordHash: hash,
    },
  });
  // Il database di prova nasce già seminato: si riusa uno stato esistente.
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.DEV },
  });
  const project = await prisma.project.create({
    data: {
      name: "Progetto riservato",
      members: { create: { userId: autore.id, role: "MANAGER" } },
    },
  });
  const task = await prisma.task.create({
    data: {
      title: "Con figure",
      kind: TaskKind.PROJECT,
      statusId: status.id,
      projectId: project.id,
      creatorId: autore.id,
    },
  });
  taskId = task.id;
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("figure incollate nelle descrizioni", () => {
  let url = "";

  it("chi può scrivere la descrizione può incollarci un'immagine", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/inline-images`,
      headers: {
        cookie: await cookie("autore@x.local"),
        ...multipart(PNG, "schermata.png", "image/png").headers,
      },
      payload: multipart(PNG, "schermata.png", "image/png").payload,
    });
    expect(res.statusCode).toBe(201);
    url = res.json().url;
    // L'indirizzo è relativo e nostro: è quello che la ripulitura lascia passare.
    expect(url).toMatch(new RegExp(`^/api/tasks/${taskId}/inline/[0-9a-f-]+\\.png$`));
  });

  it("si rilegge da chi vede il task", async () => {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { cookie: await cookie("autore@x.local") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.length).toBe(PNG.length);
  });

  it("chi il task non lo vede non vede nemmeno le sue figure", async () => {
    // Il task è di un progetto di cui non è membro: l'immagine non esiste, per lui.
    const res = await app.inject({
      method: "GET",
      url,
      headers: { cookie: await cookie("estraneo@x.local") },
    });
    expect(res.statusCode).toBe(404);
  });

  it("chi non può modificare il task non ci incolla dentro niente", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/inline-images`,
      headers: {
        cookie: await cookie("estraneo@x.local"),
        ...multipart(PNG, "schermata.png", "image/png").headers,
      },
      payload: multipart(PNG, "schermata.png", "image/png").payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it("senza sessione non si carica e non si legge", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
  });

  it("si incollano immagini, non documenti", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/inline-images`,
      headers: {
        cookie: await cookie("autore@x.local"),
        ...multipart(Buffer.from("%PDF-1.4"), "contratto.pdf", "application/pdf").headers,
      },
      payload: multipart(Buffer.from("%PDF-1.4"), "contratto.pdf", "application/pdf").payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("un nome inventato non esce dalla cartella del task", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/inline/..%2F..%2Fapp.db.png`,
      headers: { cookie: await cookie("autore@x.local") },
    });
    expect(res.statusCode).toBe(404);
  });
});
