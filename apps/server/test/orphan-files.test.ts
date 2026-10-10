// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { prepareTestDb } from "./support/test-db";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("orphan-files");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");

const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { attachmentStore } = await import("../src/modules/attachments/store");
const { sweepOrphanFiles, GRACE_DAYS } = await import("../src/modules/attachments/orphan-files");
const { hardDeleteTask } = await import("../src/modules/trash/service");

/**
 * **La pulizia dei file orfani cancella roba.** Quel che si prova qui è
 * soprattutto ciò che NON deve toccare: sul magazzino di produzione, di 49
 * file 13 erano citati soltanto dentro una descrizione o in `avatarUrl`, e una
 * pulizia che avesse guardato la sola tabella degli allegati avrebbe portato
 * via tredici immagini vive e la foto di un utente (20/08/2026).
 */

const VECCHIO = new Date("2026-01-01T00:00:00.000Z");
let userId: string;
let statusId: string;

/** Scrive un file e lo invecchia, così non cade nella finestra di grazia. */
async function fileVecchio(key: string) {
  await attachmentStore().write(key, Buffer.from("contenuto"));
  const { utimes } = await import("node:fs/promises");
  await utimes(path.join(process.env.UPLOADS_DIR!, key), VECCHIO, VECCHIO);
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: "u@test.local",
      name: "Utente",
      role: UserRole.ADMIN,
      passwordHash: await hashPassword("prova1234"),
    },
  });
  userId = user.id;
  statusId = (
    await prisma.taskStatus.findFirstOrThrow({ where: { category: ActivityCategory.ADMIN } })
  ).id;
});

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("la pulizia dei file orfani", () => {
  it("toglie un file che nessun record e nessun testo nomina", async () => {
    await fileVecchio("t-morto/_inline/abbandonata.png");
    const esito = await sweepOrphanFiles({ now: new Date("2026-08-20T03:00:00.000Z") });
    expect(esito.rimossi).toEqual(["t-morto/_inline/abbandonata.png"]);
    expect(await attachmentStore().exists("t-morto/_inline/abbandonata.png")).toBe(false);
  });

  it("NON tocca una figura citata dentro una descrizione", async () => {
    // Non ha un record da nessuna parte: il suo unico riferimento è il testo.
    const task = await prisma.task.create({
      data: { kind: TaskKind.ADMIN, title: "Con figura", statusId, creatorId: userId },
    });
    await fileVecchio(`${task.id}/_inline/viva.png`);
    await prisma.task.update({
      where: { id: task.id },
      data: { description: `<p><img src="/api/tasks/${task.id}/inline/viva.png"></p>` },
    });

    const esito = await sweepOrphanFiles({ now: new Date("2026-08-20T03:00:00.000Z") });
    expect(esito.rimossi).not.toContain(`${task.id}/_inline/viva.png`);
    expect(await attachmentStore().exists(`${task.id}/_inline/viva.png`)).toBe(true);
  });

  it("NON tocca l'immagine del profilo, che vive solo in avatarUrl", async () => {
    await fileVecchio("_avatars/faccia.jpeg");
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: "/api/avatars/faccia.jpeg" },
    });
    const esito = await sweepOrphanFiles({ now: new Date("2026-08-20T03:00:00.000Z") });
    expect(esito.rimossi).not.toContain("_avatars/faccia.jpeg");
  });

  it("NON tocca le istantanee del database né l'area d'attesa", async () => {
    // Hanno una scadenza propria: passare di qui vorrebbe dire dargliene due.
    await fileVecchio("backup/keelops-20260101-0000-0.9.0-abc1234.db.gz");
    await fileVecchio("_pending/incollata-ieri.png");
    const esito = await sweepOrphanFiles({ now: new Date("2026-08-20T03:00:00.000Z") });
    expect(esito.rimossi).toEqual([]);
    expect(esito.riservati).toBe(2);
  });

  it("lascia stare i file appena scritti: potrebbero essere a metà di un caricamento", async () => {
    // È la sola finestra in cui un file senza record non è un orfano ma un
    // file appena nato.
    await attachmentStore().write("_orfano-di-oggi.bin", Buffer.from("x"));
    const esito = await sweepOrphanFiles({ now: new Date() });
    expect(esito.rimossi).not.toContain("_orfano-di-oggi.bin");
    expect(esito.recenti).toBeGreaterThan(0);
    // …ma passata la finestra, se ne va.
    const dopo = new Date(Date.now() + (GRACE_DAYS + 1) * 24 * 60 * 60 * 1000);
    const secondo = await sweepOrphanFiles({ now: dopo, dryRun: true });
    expect(secondo.rimossi).toContain("_orfano-di-oggi.bin");
    // dryRun: dice cosa toglierebbe, e non lo toglie.
    expect(await attachmentStore().exists("_orfano-di-oggi.bin")).toBe(true);
  });

  it("eliminare un task per davvero porta via le sue figure", async () => {
    // Erano la sola via da cui nascevano orfani veri: nessun record da cui
    // cadere, e il testo che le citava sparisce con il task.
    const task = await prisma.task.create({
      data: {
        kind: TaskKind.ADMIN,
        title: "Da cancellare",
        statusId,
        creatorId: userId,
        deletedAt: new Date(),
      },
    });
    await fileVecchio(`${task.id}/_inline/figura.png`);
    await hardDeleteTask(task.id);
    expect(await attachmentStore().exists(`${task.id}/_inline/figura.png`)).toBe(false);
  });
});
