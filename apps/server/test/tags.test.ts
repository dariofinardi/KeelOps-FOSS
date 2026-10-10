// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("tags");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie = "";
let statusId = "";

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  statusId = status.id;

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

describe("tag", () => {
  it("crea, elenca e deduplica per nome", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: { name: "urgente" },
    });
    expect(created.statusCode).toBe(201);
    const tagId = created.json().id as string;

    // Stesso nome: restituisce quello esistente, non un duplicato.
    const again = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: { name: "urgente" },
    });
    expect(again.json().id).toBe(tagId);

    const list = await app.inject({ method: "GET", url: "/api/tags", headers: { cookie } });
    expect(list.json().filter((t: { name: string }) => t.name === "urgente")).toHaveLength(1);
  });

  it("applica i tag alla creazione del task e li filtra", async () => {
    const tag = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: { name: "fatturabile" },
    });
    const tagId = tag.json().id as string;

    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie },
      payload: { title: "Con tag", statusId, tagIds: [tagId] },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json().tags).toEqual([{ id: tagId, name: "fatturabile", color: null }]);

    // Filtro per tag: solo il task che lo porta.
    const filtered = await app.inject({
      method: "GET",
      url: `/api/tasks?tagId=${tagId}`,
      headers: { cookie },
    });
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().items[0].title).toBe("Con tag");

    // Il conteggio del tag riflette l'uso.
    const list = await app.inject({ method: "GET", url: "/api/tags", headers: { cookie } });
    expect(list.json().find((t: { id: string }) => t.id === tagId).taskCount).toBe(1);
  });

  it("in modifica i tagIds sostituiscono l'insieme corrente", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: { name: "alpha" },
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: { name: "beta" },
    });
    const aId = a.json().id as string;
    const bId = b.json().id as string;

    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie },
      payload: { title: "Sostituzione", statusId, tagIds: [aId] },
    });
    const taskId = task.json().id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie },
      payload: { tagIds: [bId] },
    });
    expect(patched.json().tags.map((t: { name: string }) => t.name)).toEqual(["beta"]);

    // Svuotare: nessun tag.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie },
      payload: { tagIds: [] },
    });
    expect(cleared.json().tags).toEqual([]);
  });
});
