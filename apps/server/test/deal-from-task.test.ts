import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttachmentType, TaskKind } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";
import { dealFromTaskScenario } from "./support/deal-from-task-scenario";

/**
 * **Un'offerta creata da un task** (06/10/2026): la crea il manager del progetto
 * o dell'area, eredita titolo, descrizione (senza le figure del task) e cliente
 * (del task o del progetto), nasce vinta con il task di fatturazione, e fra gli
 * allegati ha il link al task — che si apre nel pannello (che il monitor
 * vendite non lo veda è in commercial/deal-from-task-monitor). In più: ogni
 * modifica dell'offerta resta in cronologia.
 */
process.env.APP_BASE_URL = "https://crm.prova.it";
const { tempDir } = prepareTestDb("deal-from-task");

let ctx: Awaited<ReturnType<typeof dealFromTaskScenario>>;
let app: typeof ctx.app;
let prisma: typeof ctx.prisma;
let ids: typeof ctx.ids;
let chiama: typeof ctx.chiama;

beforeAll(async () => {
  ctx = await dealFromTaskScenario();
  ({ app, prisma, ids, chiama } = ctx);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("offerta da un task", () => {
  it("chi lavora al progetto senza esserne manager non la crea", async () => {
    const res = await chiama("dev@x.local", "POST", `/api/tasks/${ids.task}/deal`, {
      title: "X",
      dealValue: 1000,
    });
    expect(res.statusCode).toBe(403);
  });

  it("vinta senza valore no: conterebbe zero", async () => {
    const res = await chiama("pm@x.local", "POST", `/api/tasks/${ids.task}/deal`, {
      title: "Esportazione in PDF/A",
    });
    expect(res.statusCode).toBe(400);
  });

  it("il manager del progetto la crea: vinta, del cliente del progetto, con il link al task", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: ids.task } });
    const res = await chiama("pm@x.local", "POST", `/api/tasks/${ids.task}/deal`, {
      title: task.title,
      description: task.description,
      dealValue: 2400,
    });
    expect(res.statusCode).toBe(201);
    ids.offerta = res.json().id;
    const offerta = await prisma.task.findUniqueOrThrow({
      where: { id: ids.offerta },
      include: { attachments: { include: { attachment: true } }, dealStage: true },
    });
    expect(offerta).toMatchObject({
      kind: TaskKind.DEAL,
      title: "Esportazione in PDF/A",
      companyId: ids.cliente,
      assigneeId: ids.pm,
      creatorId: ids.pm,
      probability: 100,
      dealValue: 2400,
    });
    expect(offerta.dealStage?.isWon).toBe(true);
    expect(offerta.closedAt).not.toBeNull();
    // la figura incollata nel task non si porta dietro
    expect(offerta.description).toBe("<p>Serve il PDF/A-2b.</p><p></p>");
    // niente file né chat del task: un solo allegato, il link
    expect(offerta.attachments.map((a) => a.attachment)).toEqual([
      expect.objectContaining({
        type: AttachmentType.LINK,
        name: "Task di origine: Esportazione in PDF/A",
        url: `https://crm.prova.it/bacheche?task=${ids.task}`,
      }),
    ]);
    // il task ricorda di aver generato un'offerta
    const voce = await prisma.activityLog.findFirstOrThrow({
      where: { taskId: ids.task, action: "deal_created" },
    });
    expect(JSON.parse(voce.payload!)).toEqual({ title: "Esportazione in PDF/A" });
    // vinta: parte il task di fatturazione per l'amministrazione
    expect(await prisma.task.count({ where: { sourceDealId: ids.offerta } })).toBe(1);
  });

  it("il link si apre nel pannello del task", async () => {
    const link = await prisma.taskAttachment.findFirstOrThrow({ where: { taskId: ids.offerta } });
    const aperto = await chiama(
      "admin@x.local",
      "GET",
      `/api/attachments/${link.attachmentId}/open`,
    );
    expect(aperto.json()).toMatchObject({ mode: "task", taskId: ids.task });
  });
});

describe("ogni modifica dell'offerta resta in cronologia", () => {
  it("titolo, descrizione, cliente, motivo, visibilità agli investitori", async () => {
    // Visible to the sales monitors before the change, so switching it off is a change.
    await prisma.task.update({ where: { id: ids.offerta }, data: { visibleToSalesMonitors: true } });
    const res = await chiama("admin@x.local", "PATCH", `/api/deals/${ids.offerta}`, {
      title: "Esportazione PDF/A — lotto 1",
      description: "<p>Altro testo</p>",
      companyId: null,
      lostReason: "prezzo",
      visibleToSalesMonitors: false,
    });
    expect(res.statusCode).toBe(200);
    const voci = await prisma.activityLog.findMany({ where: { taskId: ids.offerta } });
    const azioni = voci.map((v) => v.action);
    for (const attesa of [
      "renamed",
      "description_changed",
      "company_changed",
      "lost_reason_changed",
      "sales_monitor_visibility_changed",
    ]) {
      expect(azioni, attesa).toContain(attesa);
    }
    const cliente = voci.find((v) => v.action === "company_changed")!;
    expect(JSON.parse(cliente.payload!)).toEqual({ from: "Studio Rossi", to: null });
  });

  it("salvare gli stessi valori non scrive niente", async () => {
    const prima = await prisma.activityLog.count({ where: { taskId: ids.offerta } });
    await chiama("admin@x.local", "PATCH", `/api/deals/${ids.offerta}`, {
      title: "Esportazione PDF/A — lotto 1",
      visibleToSalesMonitors: false,
    });
    expect(await prisma.activityLog.count({ where: { taskId: ids.offerta } })).toBe(prima);
  });
});
