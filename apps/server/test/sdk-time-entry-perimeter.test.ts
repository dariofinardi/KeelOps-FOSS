// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectRole, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";
// @ts-expect-error — modulo .mjs dell'SDK, senza tipi
import { timeEntryPerimeter } from "../../../plugins/keelops-sdk/perimeter.mjs";

/**
 * **Le ore che un plugin può sommare sono quelle del core** (14/10/2026).
 *
 * Il perimetro delle registrazioni dell'SDK non è una copia prudente come
 * quello dei task: è la stessa regola di `accessibleEntriesWhere`, scritta in
 * SQL. Qui le due girano sullo stesso database, per ogni tipo di persona, e
 * devono scegliere le stesse righe — altrimenti i totali di un report fatto
 * dal connettore MCP non tornerebbero con la pagina del timesheet.
 */
const { tempDir } = prepareTestDb("sdk-time-entry-perimeter");

const { prisma } = await import("../src/db");
const { accessibleEntriesWhere } = await import("../src/modules/hours/helpers");

type Perimetro = { where: string; params: string[] };
const ids: Record<string, string> = {};

beforeAll(async () => {
  const persone: Array<[string, string, boolean]> = [
    ["admin", UserRole.ADMIN, false],
    ["revisore", UserRole.MEMBER, true], // vede tutti i timesheet
    ["manager", UserRole.MEMBER, false],
    ["supervisore", UserRole.MEMBER, false],
    ["anna", UserRole.MEMBER, false],
    ["bruno", UserRole.MEMBER, false],
  ];
  for (const [nome, role, canViewAllTimesheets] of persone) {
    ids[nome] = (
      await prisma.user.create({
        data: { email: `${nome}@x.local`, name: nome, role, canViewAllTimesheets },
      })
    ).id;
  }
  const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "DEV" } });
  ids.gestito = (await prisma.project.create({ data: { name: "Gestito" } })).id;
  ids.altro = (await prisma.project.create({ data: { name: "Altro" } })).id;
  await prisma.projectMember.create({
    data: { projectId: ids.gestito, userId: ids.manager!, role: ProjectRole.MANAGER },
  });
  // membro semplice di un progetto: non per questo vede le ore degli altri
  await prisma.projectMember.create({
    data: { projectId: ids.altro, userId: ids.manager!, role: ProjectRole.EDITOR },
  });
  const task = async (chiave: string, extra: Record<string, unknown>) => {
    ids[chiave] = (
      await prisma.task.create({
        data: {
          kind: "PROJECT",
          title: chiave,
          statusId: stato.id,
          creatorId: ids.anna!,
          ...extra,
        },
      })
    ).id;
  };
  await task("nelGestito", { projectId: ids.gestito });
  await task("nellAltro", { projectId: ids.altro });
  await task("supervisionato", { projectId: ids.altro, supervisorId: ids.supervisore });
  await task("cestinato", {
    projectId: ids.altro,
    supervisorId: ids.supervisore,
    deletedAt: new Date("2026-09-20T00:00:00.000Z"),
  });
  await task("personale", { kind: "PERSONAL", creatorId: ids.bruno });
  let giorno = 1;
  for (const chi of ["anna", "bruno", "manager", "supervisore"]) {
    for (const dove of ["nelGestito", "nellAltro", "supervisionato", "cestinato", "personale"]) {
      await prisma.timeEntry.create({
        data: {
          userId: ids[chi]!,
          taskId: ids[dove]!,
          date: new Date(`2026-09-${String(giorno++).padStart(2, "0")}T00:00:00.000Z`),
          hours: 1,
        },
      });
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

async function conIlCore(nome: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ids[nome]! } });
  const righe = await prisma.timeEntry.findMany({
    where: accessibleEntriesWhere(user),
    select: { id: true },
  });
  return righe.map((r) => r.id).sort();
}

async function conLSdk(nome: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ids[nome]! } });
  const per = timeEntryPerimeter(user) as Perimetro;
  const righe = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT e.id FROM TimeEntry e WHERE ${per.where}`,
    ...per.params,
  );
  return righe.map((r) => r.id).sort();
}

describe("perimetro delle registrazioni dell'SDK", () => {
  it.each(["admin", "revisore", "manager", "supervisore", "anna", "bruno"])(
    "per %s sceglie le stesse righe del core",
    async (nome) => {
      expect(await conLSdk(nome)).toEqual(await conIlCore(nome));
    },
  );

  it("la prova non è banale: chi vede tutto, chi un po' e chi solo le sue", async () => {
    const tutte = await prisma.timeEntry.count();
    expect((await conLSdk("admin")).length).toBe(tutte);
    expect((await conLSdk("revisore")).length).toBe(tutte);
    // il manager: le sue 5, più quelle degli altri tre sul progetto che gestisce
    expect((await conLSdk("manager")).length).toBe(8);
    // il supervisore: le sue 5, più quelle degli altri sui due task che segue (anche nel cestino)
    expect((await conLSdk("supervisore")).length).toBe(11);
    expect((await conLSdk("anna")).length).toBe(5);
  });
});
