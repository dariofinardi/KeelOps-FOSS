// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("usermig");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { prisma } = await import("../src/db");
const { mergeUser, renameUser, findUserByEmail } = await import("../src/modules/users/migration");

let statusId = "";

beforeAll(async () => {
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  statusId = status.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("migrazione utenti", () => {
  it("rinomina l'email quando la destinazione non esiste", async () => {
    const user = await prisma.user.create({
      data: { email: "vecchia@x.local", name: "Da rinominare", role: UserRole.MEMBER },
    });
    await renameUser(user.id, "NUOVA@x.local");
    const renamed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(renamed.email).toBe("nuova@x.local"); // normalizzata minuscola
    expect(await findUserByEmail("nuova@x.local")).not.toBeNull();
  });

  it("fonde un utente in un altro: dati riassegnati, ore sommate, origine eliminata", async () => {
    const from = await prisma.user.create({
      data: { email: "from@x.local", name: "Origine", role: UserRole.MEMBER },
    });
    const to = await prisma.user.create({
      data: { email: "to@x.local", name: "Destinazione", role: UserRole.MEMBER },
    });

    // Task creato da `from`, commento, e ore su un task condiviso nello stesso giorno.
    const task = await prisma.task.create({
      data: { title: "Task di origine", statusId, creatorId: from.id, assigneeId: from.id },
    });
    await prisma.comment.create({ data: { taskId: task.id, authorId: from.id, body: "nota" } });
    const day = new Date("2026-05-01T00:00:00.000Z");
    // Stesso task+giorno per entrambi: le ore vanno sommate (4 + 3 = 7).
    await prisma.timeEntry.create({
      data: { userId: from.id, taskId: task.id, date: day, hours: 4 },
    });
    await prisma.timeEntry.create({
      data: { userId: to.id, taskId: task.id, date: day, hours: 3 },
    });

    const counts = await mergeUser(from, to);
    expect(counts.tasksCreator).toBe(1);
    expect(counts.tasksAssignee).toBe(1);
    expect(counts.comments).toBe(1);
    expect(counts.timeEntriesMerged).toBe(1);

    // Origine sparita, dati passati a destinazione.
    expect(await prisma.user.findUnique({ where: { id: from.id } })).toBeNull();
    const movedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(movedTask.creatorId).toBe(to.id);
    expect(movedTask.assigneeId).toBe(to.id);

    // Le ore sono state sommate su una sola riga.
    const entries = await prisma.timeEntry.findMany({ where: { taskId: task.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.userId).toBe(to.id);
    expect(entries[0]!.hours).toBe(7);
  });

  it("rifiuta la fusione su un utente di sistema", async () => {
    const from = await prisma.user.create({
      data: { email: "src@x.local", name: "Src", role: UserRole.MEMBER },
    });
    const archive = await prisma.user.create({
      data: { email: "arch@x.local", name: "Archivio", role: UserRole.MEMBER, isSystem: true },
    });
    await expect(mergeUser(from, archive)).rejects.toThrow(/sistema/);
  });
});
