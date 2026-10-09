import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m3");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { materializeTemplate } = await import("../src/modules/recurrence/service");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;

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
  // Stati dalle migrazioni: le occorrenze nascono nel primo stato GENERAL.
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "admin@test.local", password: "admin1234" },
  });
  adminCookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ricorrenza legata a un'offerta", () => {
  it("le occorrenze restano nello scadenzario col riferimento all'offerta", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const salesStatus = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "SALES" },
      orderBy: { order: "asc" },
    });
    const deal = await prisma.task.create({
      data: {
        kind: "DEAL",
        title: "Tecnovision — canone",
        statusId: salesStatus.id,
        creatorId: admin.id,
      },
    });

    // La prima scadenza cade tra 10 giorni: dentro la finestra di
    // materializzazione (60 giorni), a differenza di un trimestre fisso.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 10);

    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Canone trimestrale Tecnovision",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
        dtstart: start.toISOString().slice(0, 10),
        relatedDealId: deal.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().relatedDeal).toEqual({ id: deal.id, name: "Tecnovision — canone" });

    const occurrences = await prisma.task.findMany({
      where: { recurrenceTemplateId: created.json().id },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    for (const task of occurrences) {
      // Task dello scadenzario: cambia la tracciabilità, non la visibilità.
      expect(task.kind).toBe("ADMIN");
      expect(task.projectId).toBeNull();
      expect(task.relatedDealId).toBe(deal.id);
    }
  });

  it("usa lo stato iniziale configurato per le occorrenze", async () => {
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "desc" }, // uno stato aperto diverso dall'iniziale di default
    });
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 5);

    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Con stato iniziale",
        rrule: "FREQ=MONTHLY",
        dtstart: start.toISOString().slice(0, 10),
        initialStatusId: status.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().initialStatus.id).toBe(status.id);

    const occurrences = await prisma.task.findMany({
      where: { recurrenceTemplateId: created.json().id },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    for (const task of occurrences) expect(task.statusId).toBe(status.id);
  });
});

describe("recurrence templates API", () => {
  it("previews next occurrences with italian description", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates/preview",
      headers: { cookie: adminCookie },
      payload: { rrule: "FREQ=MONTHLY;BYMONTHDAY=15", dtstart: "2026-01-15", count: 5 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().occurrences).toHaveLength(5);
    expect(response.json().ruleText).toBe("ogni mese, il giorno 15");
  });

  it("rejects invalid rrule strings", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates/preview",
      headers: { cookie: adminCookie },
      payload: { rrule: "NONSENSE", dtstart: "2026-01-15" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("creating a template materializes a single live occurrence, idempotently", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Backup mensile",
        rrule: "FREQ=DAILY;INTERVAL=15",
        dtstart: "2026-01-01",
      },
    });
    expect(created.statusCode).toBe(201);
    const templateId = created.json().id;

    const occurrences = await prisma.task.findMany({
      where: { recurrenceTemplateId: templateId },
    });
    // Modello a occorrenza singola: una sola occorrenza viva, non la finestra 60 giorni.
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.dueDate).not.toBeNull();

    // Idempotente: esiste già la viva, non se ne crea un'altra.
    const createdAgain = await materializeTemplate(templateId);
    expect(createdAgain).toBe(0);
  });

  it("updating the title renames the untouched occurrence but not a worked one", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Vecchio titolo", rrule: "FREQ=DAILY;INTERVAL=20", dtstart: "2026-01-01" },
    });
    const templateId = created.json().id;
    const occ = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });

    // Occorrenza ancora "non lavorata" (nello stato iniziale): il rename la aggiorna.
    await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${templateId}`,
      headers: { cookie: adminCookie },
      payload: { title: "Nuovo titolo" },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: occ.id } })).title).toBe(
      "Nuovo titolo",
    );

    // Ora la "lavoro" (stato diverso dall'iniziale): un rename successivo NON la tocca.
    const inProgress = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "GENERAL", name: "In corso" },
    });
    await prisma.task.update({ where: { id: occ.id }, data: { statusId: inProgress.id } });
    await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${templateId}`,
      headers: { cookie: adminCookie },
      payload: { title: "Titolo finale" },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: occ.id } })).title).toBe(
      "Nuovo titolo",
    );
  });

  it("changing the schedule regenerates the untouched occurrence", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Cambio regola", rrule: "FREQ=DAILY;INTERVAL=10", dtstart: "2026-01-01" },
    });
    const templateId = created.json().id;
    const before = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(before).toHaveLength(1); // occorrenza singola

    await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${templateId}`,
      headers: { cookie: adminCookie },
      payload: { rrule: "FREQ=MONTHLY;BYMONTHDAY=-1" },
    });
    const after = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(after).toHaveLength(1); // rigenerata, sempre una sola
    // Rigenerata secondo la nuova regola: cade nell'ultimo giorno del mese.
    const d = after[0]!.dueDate!;
    const dayAfter = new Date(d);
    dayAfter.setUTCDate(d.getUTCDate() + 1);
    expect(dayAfter.getUTCDate()).toBe(1);
  });

  it("delete with deleteFuture removes future untouched occurrences", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Da eliminare", rrule: "FREQ=DAILY;INTERVAL=7", dtstart: "2026-01-01" },
    });
    const templateId = created.json().id;
    expect(
      await prisma.task.count({ where: { recurrenceTemplateId: templateId } }),
    ).toBeGreaterThan(0);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/recurrence-templates/${templateId}?deleteFuture=true`,
      headers: { cookie: adminCookie },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await prisma.task.count({ where: { recurrenceTemplateId: templateId } })).toBe(0);
  });

  it("template link attachments propagate to future untouched occurrences", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Con allegato", rrule: "FREQ=DAILY;INTERVAL=30", dtstart: "2026-01-01" },
    });
    const templateId = created.json().id;

    const withLink = await app.inject({
      method: "POST",
      url: `/api/recurrence-templates/${templateId}/attachments/link`,
      headers: { cookie: adminCookie },
      payload: { name: "Modello F24", url: "https://drive.google.com/x" },
    });
    expect(withLink.statusCode).toBe(201);
    expect(withLink.json().attachments).toHaveLength(1);

    const occurrences = await prisma.task.findMany({
      where: { recurrenceTemplateId: templateId },
      include: { attachments: true },
    });
    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.every((t) => t.attachments.length === 1)).toBe(true);
  });
});

describe("ripianificare la serie lo dice a chi sta guardando un'occorrenza", () => {
  /**
   * Cambiando regola o prima occorrenza, le occorrenze future non lavorate
   * vengono eliminate e **rigenerate con un altro id**. Chi ne aveva una aperta
   * nel pannello si ritrovava a modificare un fantasma: "task non trovato", e
   * quello che scriveva andava perso senza che nessuno glielo dicesse
   * (14/08/2026). Ora la risposta lo dichiara e il pannello si chiude.
   */
  it("la risposta dichiara che le occorrenze sono state rigenerate", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Canone mensile",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
        dtstart: "2027-01-15",
      },
    });
    expect(created.statusCode).toBe(201);
    const templateId = created.json().id;
    const prima = await prisma.task.findMany({
      where: { recurrenceTemplateId: templateId },
      select: { id: true },
    });
    expect(prima.length).toBeGreaterThan(0);

    // Cambio della prima occorrenza: pianificazione toccata.
    const ripianificata = await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${templateId}`,
      headers: { cookie: adminCookie },
      payload: { dtstart: "2027-02-20" },
    });
    expect(ripianificata.statusCode).toBe(200);
    expect(ripianificata.json().occurrencesRegenerated).toBe(true);
    // …e infatti le occorrenze di prima non esistono più.
    const rimaste = await prisma.task.count({ where: { id: { in: prima.map((t) => t.id) } } });
    expect(rimaste).toBe(0);
  });

  it("cambiando solo il titolo non si rigenera niente, e non si chiude niente", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: { title: "Verifica backup", rrule: "FREQ=MONTHLY;BYMONTHDAY=3", dtstart: "2027-03-03" },
    });
    const templateId = created.json().id;
    const prima = await prisma.task.findMany({
      where: { recurrenceTemplateId: templateId },
      select: { id: true },
    });

    const risposta = await app.inject({
      method: "PATCH",
      url: `/api/recurrence-templates/${templateId}`,
      headers: { cookie: adminCookie },
      payload: { title: "Verifica backup notturni" },
    });
    expect(risposta.statusCode).toBe(200);
    expect(risposta.json().occurrencesRegenerated).toBe(false);
    // Le stesse occorrenze, con il titolo aggiornato: nessun id cambiato.
    const dopo = await prisma.task.findMany({
      where: { id: { in: prima.map((t) => t.id) } },
      select: { id: true, title: true },
    });
    expect(dopo).toHaveLength(prima.length);
    expect(dopo.every((t) => t.title === "Verifica backup notturni")).toBe(true);
  });
});

describe("ricorrenza — scaduta non posticipata", () => {
  it("rematerializzare NON cambia la scadenza di un'occorrenza già creata", async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Mensile",
        rrule: "FREQ=MONTHLY",
        dtstart: start.toISOString().slice(0, 10),
      },
    });
    const templateId = created.json().id as string;

    const occ = (
      await prisma.task.findMany({
        where: { recurrenceTemplateId: templateId },
        orderBy: { occurrenceDate: "asc" },
      })
    )[0]!;
    const dueBefore = occ.dueDate?.toISOString();
    const statusBefore = occ.statusId;

    // Rematerializzare (come fa il cron): non deve toccare le occorrenze esistenti.
    await materializeTemplate(templateId);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: occ.id } });
    expect(after.dueDate?.toISOString()).toBe(dueBefore);
    expect(after.statusId).toBe(statusBefore); // resta aperta (rossa se scaduta) finché non la completi
    expect(after.closedAt).toBeNull();
  });
});
