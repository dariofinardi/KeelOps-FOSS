// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m4");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { parseContactsCsv } = await import("../src/modules/crm/csv");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { moduliAttivi } = await import("../src/edition/registry");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let outsiderCookie: string;
let trattativaId: string;
let vintaId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  const commercialGroup = await prisma.group.create({ data: { name: "Commerciale" } });
  await prisma.visibilitySetting.create({
    data: { scope: "DEALS", groupId: commercialGroup.id },
  });

  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  // Membro NON nel gruppo Commerciale: niente accesso alle offerte. Sta nel
  // gruppo Sviluppatori, che ha le Offerte in "Giornate".
  const outsider = await prisma.user.create({
    data: {
      email: "outsider@test.local",
      name: "Outsider",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("outsider1234"),
    },
  });
  const devGroup = await prisma.group.create({ data: { name: "Sviluppo (giornate)" } });
  await prisma.groupMember.create({ data: { groupId: devGroup.id, userId: outsider.id } });
  await prisma.visibilitySetting.create({
    data: { scope: "DEALS", groupId: devGroup.id, access: "DAYS" },
  });
  // Cliente del portale: non deve poter essere intestatario di un'offerta.
  await prisma.user.create({
    data: {
      email: "cliente@test.local",
      name: "Cliente Esterno",
      role: UserRole.PORTAL,
      passwordHash: await hashPassword("cliente1234"),
    },
  });

  // Gli stati arrivano dalle migrazioni: qui basta che esistano quelli GENERAL.
  const trattativa = await prisma.dealStage.create({
    data: { name: "Trattativa", color: "#f59e0b", order: 0 },
  });
  const vinta = await prisma.dealStage.create({
    data: { name: "Vinta", color: "#22c55e", order: 1, isWon: true },
  });
  trattativaId = trattativa.id;
  vintaId = vinta.id;

  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
  outsiderCookie = await loginCookie("outsider@test.local", "outsider1234");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("visibility", () => {
  it("i contatti restano riservati a chi ha il privilegio commerciale", async () => {
    // La rubrica è dato CRM: la vista in giornate non la apre.
    const contacts = await app.inject({
      method: "GET",
      url: "/api/contacts",
      headers: { cookie: outsiderCookie },
    });
    expect(contacts.statusCode).toBe(403);
    // Le aziende invece sono visibili a tutti gli utenti interni.
    const companies = await app.inject({
      method: "GET",
      url: "/api/companies",
      headers: { cookie: outsiderCookie },
    });
    expect(companies.statusCode).toBe(200);
  });

  it("un interno senza privilegio vede l'elenco in sola consultazione, spogliato", async () => {
    // Sviluppatori: l'elenco sì (valore che la UI mostra in giornate), ma senza
    // i dati CRM — contatto, esito, conteggi di allegati e chat, fatturazione.
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Vista in giornate", dealValue: 4100 },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({
      method: "GET",
      url: "/api/deals",
      headers: { cookie: outsiderCookie },
    });
    expect(list.statusCode).toBe(200);
    // Nessun euro nella risposta: il valore arriva già in giornate (4.100 € → 8).
    expect(list.json().valueUnit).toBe("DAYS");
    const items = list.json().items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.find((i) => i.title === "Vista in giornate")?.dealValue).toBe(8);
    for (const item of items) {
      expect(item.contact).toBeNull();
      expect(item.lostReason).toBeNull();
      expect(item.billingTaskId).toBeNull();
      expect(item.attachmentCount).toBe(0);
      expect(item.commentCount).toBe(0);
      expect(item.canEdit).toBe(false);
    }
    // Le fasi (nomi e colori dei badge) si leggono; configurarle resta da admin.
    const stages = await app.inject({
      method: "GET",
      url: "/api/deal-stages",
      headers: { cookie: outsiderCookie },
    });
    expect(stages.statusCode).toBe(200);
  });

  it("con «Giornate» non si apre la scheda di un'azienda estranea", async () => {
    // La lente giornate stima il carico, non apre l'anagrafica clienti: la
    // scheda di un'azienda che non è nei propri progetti torna 404. (Prima del
    // 07/08/2026 la lente apriva per errore qualunque azienda, note comprese.)
    const company = await prisma.company.create({ data: { name: "Cliente estraneo" } });
    const stage = await prisma.dealStage.findFirstOrThrow({});
    await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Offerta contata",
        creatorId: (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } }))
          .id,
        dealStageId: stage.id,
        dealValue: 5000,
        companyId: company.id,
      },
    });

    const perOutsider = await app.inject({
      method: "GET",
      url: `/api/companies/${company.id}`,
      headers: { cookie: outsiderCookie },
    });
    expect(perOutsider.statusCode).toBe(404);

    // E nell'elenco l'azienda estranea non compare.
    const list = await app.inject({
      method: "GET",
      url: "/api/companies",
      headers: { cookie: outsiderCookie },
    });
    expect(list.json().items.map((c: { name: string }) => c.name)).not.toContain(
      "Cliente estraneo",
    );
  });

  it("«Giornate» non vale come lettura: allegati e task dell'offerta restano chiusi", async () => {
    // È la proprietà che tiene: la lente viene filtrata nel punto unico che
    // calcola l'accesso ai moduli, quindi nessun controllo esistente la può
    // scambiare per una sola lettura.
    const dealId = (
      (
        await app.inject({ method: "GET", url: "/api/deals", headers: { cookie: outsiderCookie } })
      ).json().items as Array<{ id: string }>
    )[0]!.id;
    const link = await app.inject({
      method: "POST",
      url: `/api/tasks/${dealId}/attachments/link`,
      headers: { cookie: adminCookie },
      payload: { name: "Preventivo", url: "https://drive.example/x" },
    });
    expect(link.statusCode).toBe(201);
    const attachmentId = link.json().id as string;

    for (const url of [`/api/tasks/${dealId}`, `/api/attachments/${attachmentId}/open`]) {
      const res = await app.inject({ method: "GET", url, headers: { cookie: outsiderCookie } });
      expect([403, 404], `${url} non deve aprirsi`).toContain(res.statusCode);
    }
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: outsiderCookie },
    });
    expect(me.json().canSeeDeals).toBe(false);
  });

  it("«Giornate» si può configurare solo sulle Offerte", async () => {
    const groupId = (
      await prisma.group.findFirstOrThrow({ where: { name: "Sviluppo (giornate)" } })
    ).id;
    const res = await app.inject({
      method: "PUT",
      url: "/api/visibility-settings",
      headers: { cookie: adminCookie },
      payload: { scope: "ADMIN_TASKS", groups: [{ groupId, access: "DAYS" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("per lo stesso interno il dettaglio e la modifica restano chiusi", async () => {
    const anyDeal = (
      (
        await app.inject({ method: "GET", url: "/api/deals", headers: { cookie: outsiderCookie } })
      ).json().items as Array<{ id: string }>
    )[0]!;
    const detail = await app.inject({
      method: "GET",
      url: `/api/deals/${anyDeal.id}`,
      headers: { cookie: outsiderCookie },
    });
    expect(detail.statusCode).toBe(403);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/deals/${anyDeal.id}`,
      headers: { cookie: outsiderCookie },
      payload: { title: "Riscritta da fuori" },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("la lista dichiara la somma nominale dell'insieme filtrato, tutte le pagine", async () => {
    // Sotto l'intestazione "Valore" la tabella mostra questa somma: deve seguire
    // i filtri (qui la ricerca) e non fermarsi alla pagina corrente.
    for (const [title, value] of [
      ["Somma A", 1200],
      ["Somma B", 3400],
      ["Somma senza valore", null],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/deals",
        headers: { cookie: adminCookie },
        payload: { title, ...(value !== null ? { dealValue: value } : {}) },
      });
      expect(res.statusCode).toBe(201);
    }

    // Pagina da 1 elemento: la somma resta quella dell'intero insieme filtrato.
    const list = await app.inject({
      method: "GET",
      url: "/api/deals?q=Somma&page=1&pageSize=1",
      headers: { cookie: adminCookie },
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().total).toBe(3);
    expect(list.json().totalValue).toBe(4600);
    expect(list.json().valueUnit).toBe("EUR");
  });

  it("reports canSeeDeals in /me", async () => {
    const admin = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: adminCookie },
    });
    expect(admin.json().canSeeDeals).toBe(true);
    expect(admin.json().canSeeContacts).toBe(true);
    const outsider = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: outsiderCookie },
    });
    expect(outsider.json().canSeeDeals).toBe(false);
    expect(outsider.json().canSeeContacts).toBe(false);
    // Ma da interno ha la vista in giornate; un esterno (portale) no.
    expect(outsider.json().dealsDaysView).toBe(true);
  });
});

describe("proprietà e livelli di accesso offerte", () => {
  let saraCookie: string;
  let ginoCookie: string;
  let rinaCookie: string;
  let saraId: string;

  beforeAll(async () => {
    const commerciale = await prisma.group.findUniqueOrThrow({ where: { name: "Commerciale" } });
    // Gruppo Amministrativo con accesso alle offerte in SOLA LETTURA.
    const amministrativo = await prisma.group.create({ data: { name: "Amministrativo" } });
    await prisma.visibilitySetting.create({
      data: { scope: "DEALS", groupId: amministrativo.id, access: "READ" },
    });

    const sara = await prisma.user.create({
      data: {
        email: "sara@test.local",
        name: "Sara Vendite",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("sara1234"),
        groups: { create: { groupId: commerciale.id } },
      },
    });
    saraId = sara.id;
    await prisma.user.create({
      data: {
        email: "gino@test.local",
        name: "Gino Vendite",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("gino1234"),
        groups: { create: { groupId: commerciale.id } },
      },
    });
    await prisma.user.create({
      data: {
        email: "rina@test.local",
        name: "Rina Amministrativa",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("rina1234"),
        groups: { create: { groupId: amministrativo.id } },
      },
    });
    saraCookie = await loginCookie("sara@test.local", "sara1234");
    ginoCookie = await loginCookie("gino@test.local", "gino1234");
    rinaCookie = await loginCookie("rina@test.local", "rina1234");
  });

  it("solo il proprietario (assegnatario) modifica l'offerta; gli altri commerciali no", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: saraCookie },
      payload: { title: "Trattativa di Sara", assigneeId: saraId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().canEdit).toBe(true);
    const dealId = created.json().id;

    // Gino vede l'offerta ma con canEdit=false e non può modificarla.
    const ginoView = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: ginoCookie },
    });
    expect(ginoView.statusCode).toBe(200);
    expect(ginoView.json().canEdit).toBe(false);
    const ginoEdit = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: ginoCookie },
      payload: { dealValue: 999 },
    });
    expect(ginoEdit.statusCode).toBe(403);
  });

  it("l'accesso in sola lettura vede le offerte ma non crea né modifica", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: rinaCookie },
    });
    expect(me.json().canSeeDeals).toBe(true);
    expect(me.json().canEditDeals).toBe(false);

    const list = await app.inject({
      method: "GET",
      url: "/api/deals",
      headers: { cookie: rinaCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.every((d: { canEdit: boolean }) => d.canEdit === false)).toBe(true);

    const create = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: rinaCookie },
      payload: { title: "Non dovrebbe crearsi" },
    });
    expect(create.statusCode).toBe(403);
  });
});

describe("orario di scadenza sui task collegati alle offerte", () => {
  it("salva l'ora accanto al giorno e la toglie quando si toglie la data", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Chiamata conoscitiva", dueDate: "2026-07-23", dueTime: "15:30" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ dueDate: "2026-07-23", dueTime: "15:30" });
    const taskId = created.json().id as string;

    // Il giorno resta a mezzanotte UTC: l'ora non lo sposta (in Italia sarebbe domani).
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(stored.dueDate?.toISOString()).toBe("2026-07-23T00:00:00.000Z");
    expect(stored.dueTime).toBe("15:30");

    // Cronologia: la voce sulla scadenza riporta anche l'ora.
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
      payload: { dueTime: "16:00" },
    });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { taskId, action: "due_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(log.payload!)).toEqual({
      from: "2026-07-23 15:30",
      to: "2026-07-23 16:00",
    });

    // Senza data non c'è ora.
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
      payload: { dueDate: null },
    });
    expect(cleared.json().dueDate).toBeNull();
    expect(cleared.json().dueTime).toBeNull();
  });

  it("rifiuta un orario non valido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Ora sbagliata", dueDate: "2026-07-23", dueTime: "25:00" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("chi può essere commerciale di un'offerta", () => {
  it("il picker esclude i clienti del portale e chi non lavora le offerte", async () => {
    // Elenco generico: niente clienti del portale.
    const all = await app.inject({
      method: "GET",
      url: "/api/users/options",
      headers: { cookie: adminCookie },
    });
    const names = all.json().map((u: { name: string }) => u.name);
    expect(names).toContain("Outsider");
    expect(names).not.toContain("Cliente Esterno");

    // Con lo scope Offerte: solo chi ha accesso completo (l'admin sempre).
    const owners = await app.inject({
      method: "GET",
      url: "/api/users/options?scope=DEALS",
      headers: { cookie: adminCookie },
    });
    const ownerNames = owners.json().map((u: { name: string }) => u.name);
    expect(ownerNames).toContain("Admin");
    expect(ownerNames).not.toContain("Outsider");
    expect(ownerNames).not.toContain("Cliente Esterno");
  });

  it("il server rifiuta un'offerta intestata a un cliente del portale", async () => {
    const portal = await prisma.user.findUniqueOrThrow({ where: { email: "cliente@test.local" } });
    const response = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Offerta al cliente", stageId: trattativaId, assigneeId: portal.id },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("deals + billing automation", () => {
  it("creates a deal and blocks DEAL access via task api for outsiders", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Commessa Alfa", dealValue: 10000, probability: 50 },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;

    // Il deal non compare nella lista task ADMIN.
    const tasks = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
    });
    expect(tasks.json().items.some((t: { id: string }) => t.id === dealId)).toBe(false);

    // Un utente senza accesso alle offerte non può leggerlo nemmeno via /api/tasks/:id.
    const viaTask = await app.inject({
      method: "GET",
      url: `/api/tasks/${dealId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(viaTask.statusCode).toBe(403);
  });

  it("chiudere un'offerta ne fissa la data; riaprirla la toglie", async () => {
    // La previsione conta un affare concluso sul mese in cui si è concluso, non su
    // quello in cui si sperava: senza questa data conterebbe il mese sbagliato.
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: {
        title: "Commessa da chiudere",
        stageId: trattativaId,
        dealValue: 9000,
        expectedCloseDate: "2026-06-30",
      },
    });
    const dealId = created.json().id as string;
    expect(await prisma.task.findUniqueOrThrow({ where: { id: dealId } })).toMatchObject({
      closedAt: null,
    });

    await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: vintaId },
    });
    const vinta = await prisma.task.findUniqueOrThrow({ where: { id: dealId } });
    expect(vinta.closedAt).toBeInstanceOf(Date);
    // La chiusura prevista resta com'era: sono due date diverse, non una che
    // sovrascrive l'altra.
    expect(vinta.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-06-30");

    // Rimessa in trattativa: l'affare è di nuovo in gioco, la data non ha più senso.
    await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: trattativaId },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: dealId } })).closedAt).toBeNull();
  });

  it("un'offerta vinta genera il task per l'amministrazione, una sola volta", async () => {
    // Il commerciale ha un amministrativo di riferimento: è lui a ricevere il task.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const amministrativa = await prisma.user.create({
      data: { email: "amm@test.local", name: "Franca Amministrazione", role: UserRole.MEMBER },
    });
    await prisma.user.update({
      where: { id: admin.id },
      data: { billingAssigneeId: amministrativa.id },
    });
    const target = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isWonTarget: true },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: {
        title: "Commessa Beta",
        description: "Canone annuale piattaforma",
        stageId: trattativaId,
        dealValue: 5000,
      },
    });
    const dealId = created.json().id;

    // Allegato link sul deal: dovrà essere condiviso col task di fatturazione.
    await app.inject({
      method: "POST",
      url: `/api/tasks/${dealId}/attachments/link`,
      headers: { cookie: adminCookie },
      payload: { name: "Offerta firmata", url: "https://drive.google.com/offerta" },
    });

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: vintaId },
    });
    expect(moved.statusCode).toBe(200);
    const billingTaskId = moved.json().billingTaskId;
    expect(billingTaskId).not.toBeNull();

    const billingTask = await prisma.task.findUniqueOrThrow({
      where: { id: billingTaskId },
      include: { attachments: { include: { attachment: true } } },
    });
    expect(billingTask.kind).toBe("ADMIN");
    // Stesso titolo e stessa descrizione dell'offerta, scadenza a oggi.
    expect(billingTask.title).toBe("Commessa Beta");
    expect(billingTask.description).toBe("Canone annuale piattaforma");
    expect(billingTask.dueDate?.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
    // Il commerciale supervisiona, l'amministrativo di riferimento lavora.
    expect(billingTask.supervisorId).toBe(admin.id);
    expect(billingTask.assigneeId).toBe(amministrativa.id);
    // Nasce nello stato contrassegnato ("Fatture da emettere").
    expect(billingTask.statusId).toBe(target.id);
    expect(billingTask.sourceDealId).toBe(dealId);

    // Solo l'amministrativo assegnato viene avvisato.
    const notifications = await prisma.notification.findMany({
      where: { userId: amministrativa.id },
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.some((n) => n.payload.includes("Commessa Beta"))).toBe(true);
    // Allegato condiviso: stesso Attachment, nessuna copia.
    expect(billingTask.attachments).toHaveLength(1);
    expect(billingTask.attachments[0]!.attachment.name).toBe("Offerta firmata");

    // Idempotenza: torna in Trattativa e di nuovo in Vinta → nessun duplicato.
    await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: trattativaId },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: vintaId },
    });
    const billingTasks = await prisma.task.findMany({ where: { sourceDealId: dealId } });
    expect(billingTasks).toHaveLength(1);

    // Attività registrata sul deal (endpoint lazy: il deal è un Task).
    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${dealId}/activities`,
      headers: { cookie: adminCookie },
    });
    const actions = detail.json().items.map((a: { action: string }) => a.action);
    expect(actions).toContain("billing_task_created");
    expect(actions).toContain("stage_changed");
  });

  it("la fase vinta configurata definisce stato e assegnatario del task", async () => {
    // Stato e persona diversi dai default (isWonTarget / billingAssignee).
    const persona = await prisma.user.create({
      data: { email: "amm2@test.local", name: "Gigi Contabile", role: UserRole.MEMBER },
    });
    const stato = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isWonTarget: false, isClosed: false },
    });
    await prisma.dealStage.update({
      where: { id: vintaId },
      data: { wonTaskStatusId: stato.id, wonTaskAssigneeId: persona.id },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Commessa Gamma", stageId: trattativaId, dealValue: 1000 },
    });
    const dealId = created.json().id;
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: vintaId },
    });
    expect(moved.statusCode).toBe(200);

    const billingTask = await prisma.task.findUniqueOrThrow({
      where: { id: moved.json().billingTaskId },
    });
    expect(billingTask.statusId).toBe(stato.id); // stato dalla fase, non isWonTarget
    expect(billingTask.assigneeId).toBe(persona.id); // assegnatario dalla fase, non billingAssignee

    // Ripristina la fase per non influenzare altri test.
    await prisma.dealStage.update({
      where: { id: vintaId },
      data: { wonTaskStatusId: null, wonTaskAssigneeId: null },
    });
  });

  it("links a scadenzario task to a deal; it shows in the deal's linkedTasks", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Commessa con task" },
    });
    const dealId = created.json().id;

    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Richiamare il cliente", relatedDealId: dealId },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json().kind).toBe("ADMIN");
    expect(task.json().relatedDeal).toMatchObject({ id: dealId });

    const detail = await app.inject({
      method: "GET",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
    });
    const linked = detail.json().linkedTasks;
    expect(linked).toHaveLength(1);
    expect(linked[0].title).toBe("Richiamare il cliente");

    // Nella lista offerte il conteggio dei task collegati aperti è esposto.
    const list = await app.inject({
      method: "GET",
      url: "/api/deals",
      headers: { cookie: adminCookie },
    });
    const row = list.json().items.find((d: { id: string }) => d.id === dealId);
    expect(row.openTaskCount).toBe(1);

    // Non si può collegare a un progetto e a un'offerta insieme.
    const both = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Ambiguo", relatedDealId: dealId, projectId: "qualsiasi" },
    });
    expect(both.statusCode).toBe(400);
  });
});

describe("crm", () => {
  it("manages companies, contacts and dated notes", async () => {
    const company = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { cookie: adminCookie },
      payload: { name: "Beta S.p.A.", city: "Torino" },
    });
    expect(company.statusCode).toBe(201);
    const companyId = company.json().id;

    const contact = await app.inject({
      method: "POST",
      url: "/api/contacts",
      headers: { cookie: adminCookie },
      payload: { firstName: "Lucia", lastName: "Neri", email: "lucia@beta.example", companyId },
    });
    expect(contact.statusCode).toBe(201);

    const note = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/notes`,
      headers: { cookie: adminCookie },
      payload: { body: "Telefonata introduttiva: interessati alla demo." },
    });
    expect(note.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/api/companies/${companyId}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().contacts).toHaveLength(1);
    expect(detail.json().crmNotes).toHaveLength(1);
  });

  it("parses Google Contacts CSV and imports with dedup", async () => {
    const csv = [
      "First Name,Last Name,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name",
      'Mario,Bianchi,mario@gamma.example,+39 333 1111111,"Gamma, S.r.l."',
      "Elena,Verdi,elena@gamma.example,,Gamma, S.r.l.",
    ].join("\n");
    // Nota: la seconda riga ha la company non quotata → colonna extra ignorata dal mapping.
    const parsed = parseContactsCsv(csv);
    expect(parsed[0]).toMatchObject({
      firstName: "Mario",
      lastName: "Bianchi",
      email: "mario@gamma.example",
      companyName: "Gamma, S.r.l.",
    });

    const boundary = "----kancrmcsv";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="contacts.csv"`,
      "Content-Type: text/csv",
      "",
      csv,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const imported = await app.inject({
      method: "POST",
      url: "/api/contacts/import",
      headers: { cookie: adminCookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().imported).toBe(2);
    expect(imported.json().companiesCreated).toBeGreaterThanOrEqual(1);

    // Re-import: dedup per email.
    const again = await app.inject({
      method: "POST",
      url: "/api/contacts/import",
      headers: { cookie: adminCookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(again.json().imported).toBe(0);
    expect(again.json().skipped).toBe(2);
  });
});

/**
 * Il progetto di sviluppo che nasce da un'offerta vinta. Dal 21/08/2026 non
 * nasce più dallo spostamento in fase vinta ma dalla proposta letta sui
 * documenti (`deal-analysis-apply.test.ts`): qui restano le due cose che quella
 * strada dà per scontate — chi la tendina propone come guida, e che il progetto
 * nato da un'offerta la dichiari come provenienza.
 */
describe("offerta vinta: il progetto di sviluppo", () => {
  let commercialeCookie = "";

  beforeAll(async () => {
    // Area sviluppo: il gruppo che ha i Progetti in accesso completo. Anna e Zeno
    // ne sono manager (Paolo no), quindi sono "i manager degli sviluppatori".
    const anna = await prisma.user.create({
      data: { email: "anna@test.local", name: "Anna Sviluppo", role: UserRole.MEMBER },
    });
    const zeno = await prisma.user.create({
      data: { email: "zeno@test.local", name: "Zeno Sviluppo", role: UserRole.MEMBER },
    });
    const paolo = await prisma.user.create({
      data: { email: "paolo@test.local", name: "Paolo Sviluppo", role: UserRole.MEMBER },
    });
    const sviluppatori = await prisma.group.create({
      data: {
        name: "Sviluppatori",
        // Dall'11/08/2026 l'area governata è un dato del gruppo, non più dedotta
        // dagli scope (che dicono cosa il gruppo VEDE, non cosa governa).
        managedArea: "DEV",
        members: {
          create: [
            { userId: zeno.id, isManager: true },
            { userId: anna.id, isManager: true },
            { userId: paolo.id },
          ],
        },
      },
    });
    await prisma.visibilitySetting.create({
      data: { scope: "PROJECTS", groupId: sviluppatori.id, access: "FULL" },
    });

    // Il commerciale che vende: deve poter essere intestatario dell'offerta.
    const commerciale = await prisma.user.create({
      data: {
        email: "vendite@test.local",
        name: "Vera Vendite",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("vendite1234"),
      },
    });
    const gruppoCommerciale = await prisma.group.findFirstOrThrow({
      where: { name: "Commerciale" },
    });
    await prisma.groupMember.create({
      data: { groupId: gruppoCommerciale.id, userId: commerciale.id },
    });
    commercialeCookie = await loginCookie("vendite@test.local", "vendite1234");
  });

  const nuovaOfferta = async (title: string) => {
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: commercialeCookie },
      payload: { title, stageId: trattativaId, dealValue: 9000 },
    });
    return created.json().id as string;
  };

  it("chi non lo chiede non se lo ritrova: nessun progetto", async () => {
    const dealId = await nuovaOfferta("Commessa senza sviluppo");
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: commercialeCookie },
      payload: { stageId: vintaId },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().projectId).toBeNull();
    // Il task per l'amministrazione invece resta il comportamento di default.
    expect(moved.json().billingTaskId).not.toBeNull();
  });

  it("col modello di lettura spento il task per l'amministrazione nasce lo stesso", async () => {
    /**
     * Dal 21/08/2026 la fase vinta non fa più domande: mette l'offerta in
     * lettura, e le domande arrivano con la proposta. Se però il modello è
     * spento nessuno leggerà niente, e senza questo ripiego un'offerta vinta
     * non lascerebbe traccia in amministrazione.
     */
    const dealId = await nuovaOfferta("Commessa senza modello");
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: commercialeCookie },
      payload: { stageId: vintaId },
    });
    expect(moved.statusCode).toBe(200);
    // The document reading is the commercial `analisi-offerte` module: without
    // it there is no analysis state at all, and the billing task is born anyway.
    const conLettura = moduliAttivi().some((m) => m.offertaVinta);
    expect(moved.json().analysisState).toBe(conLettura ? "senza-modello" : null);
    expect(moved.json().billingTaskId).not.toBeNull();
  });

  it("elenca chi guida lo sviluppo: manager d'area e manager di progetto", async () => {
    // Paolo non è manager di gruppo, ma guida già un progetto: dev'esserci anche
    // lui, altrimenti dove i gruppi non sono configurati la tendina resta vuota.
    const paolo = await prisma.user.findUniqueOrThrow({ where: { email: "paolo@test.local" } });
    await prisma.project.create({
      data: {
        name: "Progetto guidato da Paolo",
        members: { create: { userId: paolo.id, role: "MANAGER" } },
      },
    });

    const options = await app.inject({
      method: "GET",
      url: "/api/users/options?managersOf=DEV",
      headers: { cookie: commercialeCookie },
    });
    expect(options.statusCode).toBe(200);
    const nomi = options.json().map((u: { name: string }) => u.name);
    expect(nomi).toContain("Anna Sviluppo"); // manager del gruppo Sviluppatori
    expect(nomi).toContain("Zeno Sviluppo"); // idem
    expect(nomi).toContain("Paolo Sviluppo"); // manager di un progetto
    expect(nomi).not.toContain("Vera Vendite"); // non guida niente
    // Chi è manager per entrambe le vie compare una volta sola, in ordine.
    expect(nomi).toEqual([...nomi].sort((a: string, b: string) => a.localeCompare(b)));
    expect(new Set(nomi).size).toBe(nomi.length);
  });

  it("il progetto nato da un'offerta vinta la dichiara come provenienza", async () => {
    // Il legame lo scrive chi crea il progetto dalla proposta (`applicaAnalisi`):
    // qui si verifica che l'API dei progetti lo racconti a chi lo apre.
    const dealId = await nuovaOfferta("Commessa con progetto");
    const progetto = await prisma.project.create({ data: { name: "Portale Commessa" } });
    await prisma.task.update({
      where: { id: dealId },
      data: { relatedProjectId: progetto.id },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${progetto.id}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deal).toMatchObject({ id: dealId, title: "Commessa con progetto" });
  });
});

/**
 * Negli elenchi trasversali (dashboard) i task di moduli diversi stanno insieme:
 * il titolo da solo non dice a cosa si riferiscono, quindi il DTO porta con sé
 * l'azienda cliente e il progetto. L'azienda può arrivare da tre parti diverse e
 * la risolve il server, non la UI.
 */
describe("contesto dei task: azienda e progetto", () => {
  it("il task di fatturazione eredita l'azienda dall'offerta che lo ha generato", async () => {
    const azienda = await prisma.company.create({ data: { name: "Coopselios" } });
    const created = await app.inject({
      method: "POST",
      url: "/api/deals",
      headers: { cookie: adminCookie },
      payload: { title: "Canone piattaforma", stageId: trattativaId, companyId: azienda.id },
    });
    const dealId = created.json().id;
    const won = await app.inject({
      method: "PATCH",
      url: `/api/deals/${dealId}`,
      headers: { cookie: adminCookie },
      payload: { stageId: vintaId },
    });
    const billingTaskId = won.json().billingTaskId as string;

    const tasks = await app.inject({
      method: "GET",
      url: "/api/tasks?includeClosed=true&pageSize=1000",
      headers: { cookie: adminCookie },
    });
    const billing = tasks.json().items.find((t: { id: string }) => t.id === billingTaskId) as {
      company: { name: string } | null;
      project: unknown;
    };
    // L'azienda non è sul task: sta sull'offerta di origine.
    expect(billing.company?.name).toBe("Coopselios");
    expect(billing.project).toBeNull();
  });

  it("un task di progetto porta il nome del progetto", async () => {
    const progetto = await prisma.project.create({ data: { name: "Agente Netico" } });
    const stato = await prisma.taskStatus.findFirstOrThrow({ where: { category: "DEV" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const task = await prisma.task.create({
      data: {
        kind: "PROJECT",
        projectId: progetto.id,
        title: "Prima estrazione",
        statusId: stato.id,
        creatorId: admin.id,
        assigneeId: admin.id,
      },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().project.name).toBe("Agente Netico");
    expect(detail.json().company).toBeNull();
  });
});

/**
 * **Il filtro dal vivo**: che la condizione sia giusta lo prova
 * `deal-owner-filter.test.ts`; qui si prova che arrivi fino all'elenco, insieme
 * alla ricerca — che è dove i due `OR` si sarebbero scontrati.
 */
describe("l'elenco filtrato per commerciale", () => {
  it("mie e degli altri sono complementari, e la ricerca continua a funzionare", async () => {
    const tutte = await app.inject({
      method: "GET",
      url: "/api/deals?includeClosed=true&pageSize=100",
      headers: { cookie: adminCookie },
    });
    const mie = await app.inject({
      method: "GET",
      url: "/api/deals?owner=mine&includeClosed=true&pageSize=100",
      headers: { cookie: adminCookie },
    });
    const altrui = await app.inject({
      method: "GET",
      url: "/api/deals?owner=others&includeClosed=true&pageSize=100",
      headers: { cookie: adminCookie },
    });
    for (const r of [tutte, mie, altrui]) expect(r.statusCode).toBe(200);

    const idDi = (r: typeof tutte): string[] =>
      (r.json().items as Array<{ id: string }>).map((d) => d.id);
    // Nessuna offerta in comune, e insieme fanno il totale: il filtro divide,
    // non nasconde.
    const insiemeMie = new Set(idDi(mie));
    expect(idDi(altrui).some((id) => insiemeMie.has(id))).toBe(false);
    expect(idDi(mie).length + idDi(altrui).length).toBe(idDi(tutte).length);

    // Il perimetro non schiaccia la ricerca (e viceversa): i due OR convivono.
    const cercate = await app.inject({
      method: "GET",
      url: `/api/deals?owner=mine&q=${encodeURIComponent("a")}&includeClosed=true&pageSize=100`,
      headers: { cookie: adminCookie },
    });
    expect(cercate.statusCode).toBe(200);
    for (const d of cercate.json().items as Array<{ id: string }>) {
      expect(insiemeMie.has(d.id), "la ricerca ha fatto uscire offerte fuori perimetro").toBe(true);
    }
  });
});
