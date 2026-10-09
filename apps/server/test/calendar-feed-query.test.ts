import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("calfeedquery");

const { prisma } = await import("../src/db");
const { feedQuery } = await import("../src/modules/calendar/feeds");

let referente: Awaited<ReturnType<typeof prisma.user.create>>;
let projectId = "";

beforeAll(async () => {
  referente = await prisma.user.create({
    data: { email: "ref@x.local", name: "Referente", role: UserRole.MEMBER },
  });
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.DEV, isClosed: false },
  });
  const project = await prisma.project.create({ data: { name: "Progetto riservato" } });
  projectId = project.id;
  // Il referente NON è membro: supervisiona solo, uno con data e uno senza.
  await prisma.task.create({
    data: {
      title: "Consegna con scadenza",
      kind: TaskKind.PROJECT,
      statusId: status.id,
      projectId,
      creatorId: referente.id,
      supervisorId: referente.id,
      dueDate: new Date("2026-09-01T00:00:00Z"),
    },
  });
  await prisma.task.create({
    data: {
      title: "Attivita senza scadenza",
      kind: TaskKind.PROJECT,
      statusId: status.id,
      projectId,
      creatorId: referente.id,
      supervisorId: referente.id,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("feed di progetto per un referente non-membro", () => {
  it("porta solo i task con una data, mai quelli senza", async () => {
    // Il difetto: l'OR dei propri task cancellava il filtro con-data, i task
    // senza scadenza entravano e il mapper esplodeva su date! → feed 500.
    const { where } = await feedQuery(referente, "PROJECT", projectId);
    const tasks = await prisma.task.findMany({ where, select: { title: true, dueDate: true } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Consegna con scadenza");
    expect(tasks.every((t) => t.dueDate !== null)).toBe(true);
  });
});
