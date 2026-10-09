import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **I task prestati ai plugin** (22/09/2026): un plugin non scrive in `Task`,
 * chiede al core di farlo. Il permesso è di chi preme il pulsante, le regole
 * sono quelle di sempre — stato iniziale, referente, notifiche, registro — e
 * quello che quella persona non vedrebbe torna `null`, non un errore.
 */
const { tempDir } = prepareTestDb("plugin-tasks");
const { prisma } = await import("../src/db");
const { creaTaskPerPlugin, leggiTaskPerPlugin, leggiTaskPerPluginMolti } = await import(
  "../src/plugins/plugin-tasks"
);

const ids: Record<string, string> = {};

beforeAll(async () => {
  const tutti = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.createMany({
    data: [{ scope: "ADMIN_TASKS", groupId: tutti.id }],
  });
  for (const [k, role] of [
    ["capo", UserRole.ADMIN],
    ["anna", UserRole.MEMBER],
    ["bruno", UserRole.MEMBER],
    ["estraneo", UserRole.MEMBER],
    ["spento", UserRole.MEMBER],
  ] as const) {
    ids[k] = (
      await prisma.user.create({
        data: {
          email: `${k}@x.local`,
          name: k,
          role,
          isActive: k !== "spento",
          ...(k === "capo" ? { adminUntil: new Date("2099-01-01") } : {}),
        },
      })
    ).id;
  }
  await prisma.groupMember.createMany({
    data: ["capo", "anna", "bruno"].map((k) => ({ groupId: tutti.id, userId: ids[k]! })),
  });
  ids.progetto = (await prisma.project.create({ data: { name: "Qualità" } })).id;
  // Un secondo progetto di cui Bruno e l'estraneo NON sono membri: è il modo
  // vero in cui un task resta invisibile a qualcuno.
  ids.riservato = (await prisma.project.create({ data: { name: "Riservato" } })).id;
  await prisma.projectMember.createMany({
    data: [
      { projectId: ids.progetto, userId: ids.anna!, role: "EDITOR" },
      { projectId: ids.progetto, userId: ids.bruno!, role: "EDITOR" },
      { projectId: ids.riservato, userId: ids.anna!, role: "EDITOR" },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("creaTaskPerPlugin", () => {
  it("crea il task con le regole del core: stato iniziale, registro, notifica", async () => {
    const task = await creaTaskPerPlugin("prova", ids.anna!, {
      title: "Rivedere il fornitore di tensioattivi",
      description: "Carica batterica fuori limite sul lotto L-2609-098",
      projectId: ids.progetto,
      assigneeId: ids.bruno,
      dueDate: "2026-10-15",
    });
    expect(task.title).toBe("Rivedere il fornitore di tensioattivi");
    expect(task.kind).toBe(TaskKind.PROJECT);
    expect(task.assigneeId).toBe(ids.bruno);
    expect(task.dueDate).toBe("2026-10-15");
    // lo stato iniziale lo sceglie il core, non il plugin
    expect(task.status).toBeTruthy();
    expect(task.statusClosed).toBe(false);

    const riga = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(riga.creatorId).toBe(ids.anna);
    expect(riga.projectId).toBe(ids.progetto);
    // il registro attività e la notifica all'assegnatario sono del core
    const storico = await prisma.activityLog.findMany({ where: { taskId: task.id } });
    expect(storico.map((r) => r.action)).toContain("created");
    const avvisi = await prisma.notification.findMany({ where: { userId: ids.bruno! } });
    expect(avvisi.length).toBeGreaterThan(0);
  });

  it("senza progetto nasce un task dello scadenzario", async () => {
    const task = await creaTaskPerPlugin("prova", ids.anna!, { title: "Tarare il pHmetro" });
    expect(task.kind).toBe(TaskKind.ADMIN);
    expect(task.projectId).toBeNull();
  });

  it("vale il permesso di chi preme, non quello del plugin", async () => {
    await expect(
      creaTaskPerPlugin("prova", ids.estraneo!, { title: "Abusivo", projectId: ids.progetto }),
    ).rejects.toThrow();
    const quanti = await prisma.task.count({ where: { title: "Abusivo" } });
    expect(quanti).toBe(0);
  });

  it("un utente spento o inesistente non crea niente, e un titolo vuoto nemmeno", async () => {
    await expect(creaTaskPerPlugin("prova", ids.spento!, { title: "No" })).rejects.toThrow(/utente non valido/);
    await expect(creaTaskPerPlugin("prova", "non-esiste", { title: "No" })).rejects.toThrow(
      /utente non valido/,
    );
    await expect(creaTaskPerPlugin("prova", ids.anna!, { title: "   " })).rejects.toThrow(/titolo/);
  });
});

describe("leggiTaskPerPlugin", () => {
  it("torna il task a chi lo vede, con lo stato e se lo può modificare", async () => {
    const task = await creaTaskPerPlugin("prova", ids.anna!, {
      title: "Verifica di efficacia",
      projectId: ids.progetto,
    });
    const letto = await leggiTaskPerPlugin(ids.bruno!, task.id);
    expect(letto?.title).toBe("Verifica di efficacia");
    expect(letto?.canEdit).toBe(true);
    expect(letto?.status).toBeTruthy();
  });

  it("torna null — non un errore — a chi non lo vede, e per un task che non c'è", async () => {
    // Un task di un progetto di cui non si è membri: la regola del core lo
    // nasconde (404), ed è il caso vero in cui un plugin deve mostrare meno.
    const nascosto = await creaTaskPerPlugin("prova", ids.anna!, {
      title: "Nel progetto riservato",
      projectId: ids.riservato,
    });
    expect(await leggiTaskPerPlugin(ids.estraneo!, nascosto.id)).toBeNull();
    expect(await leggiTaskPerPlugin(ids.anna!, "non-esiste")).toBeNull();
    expect(await leggiTaskPerPlugin("non-esiste", nascosto.id)).toBeNull();
    expect(await leggiTaskPerPlugin(ids.spento!, nascosto.id)).toBeNull();
  });

  it("un task nel cestino non torna", async () => {
    const task = await creaTaskPerPlugin("prova", ids.anna!, { title: "Da cestinare", projectId: ids.progetto });
    await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    expect(await leggiTaskPerPlugin(ids.anna!, task.id)).toBeNull();
  });

  it("la lettura in blocco salta quelli che non si vedono, senza fallire", async () => {
    const mio = await creaTaskPerPlugin("prova", ids.anna!, { title: "Nostro", projectId: ids.progetto });
    const altrui = await creaTaskPerPlugin("prova", ids.anna!, {
      title: "Suo",
      projectId: ids.riservato,
    });
    // l'estraneo non vede né l'uno né l'altro, e l'id inesistente non fa rumore
    const letti = await leggiTaskPerPluginMolti(ids.estraneo!, [mio.id, altrui.id, "non-esiste"]);
    expect([...letti.keys()]).toEqual([]);
    // chi vede il progetto riservato li vede entrambi
    const entrambi = await leggiTaskPerPluginMolti(ids.anna!, [mio.id, altrui.id]);
    expect([...entrambi.keys()].sort()).toEqual([mio.id, altrui.id].sort());
    expect(entrambi.get(mio.id)?.title).toBe("Nostro");
    // bruno è nel progetto qualità ma non in quello riservato: ne vede uno solo
    const uno = await leggiTaskPerPluginMolti(ids.bruno!, [mio.id, altrui.id]);
    expect([...uno.keys()]).toEqual([mio.id]);
  });
});
