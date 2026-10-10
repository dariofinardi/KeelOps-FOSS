// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("recadv");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { planRecurrenceAdvance } = await import("../src/modules/recurrence/service");
/** Data della prossima occorrenza pianificata (senza crearla), come faceva ensureNextOccurrence. */
async function nextDate(templateId: string, after: Date): Promise<Date | null> {
  return (await planRecurrenceAdvance(templateId, after))?.next ?? null;
}
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let closedStatusId: string;

/** Data (YYYY-MM-DD) a N giorni da oggi, sulla mezzanotte UTC delle scadenze. */
function isoPlusDays(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoPlusYear(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

async function createTemplate(payload: {
  title: string;
  rrule: string;
  dtstart: string;
}): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/recurrence-templates",
    headers: { cookie: adminCookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

/** Completa un task e restituisce il corpo della risposta. */
async function complete(taskId: string) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/tasks/${taskId}`,
    headers: { cookie: adminCookie },
    payload: { statusId: closedStatusId },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

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
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: true },
    orderBy: { order: "asc" },
  });
  closedStatusId = closed.id;

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

describe("spunta di completamento e cronologia", () => {
  it("completare una ricorrenza ricicla lo STESSO task in avanti (stato aperto), con traccia", async () => {
    // Stessa chiamata che fa la spunta nel kanban: stato → chiuso.
    const templateId = await createTemplate({
      title: "Liquidazione IVA",
      rrule: "FREQ=MONTHLY",
      dtstart: isoPlusDays(3),
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
      orderBy: { occurrenceDate: "asc" },
    });
    const originalDate = occurrence.occurrenceDate!.toISOString().slice(0, 10);

    const done = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${occurrence.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    expect(done.statusCode).toBe(200);
    // NON si chiude: lo stesso task ricicla in avanti, in uno stato aperto.
    expect(done.json().status.isClosed).toBe(false);
    expect(done.json().closedAt).toBeNull();
    expect(done.json().nextOccurrenceDate).toBeTruthy();
    expect(done.json().nextOccurrenceDate).not.toBe(originalDate);

    // Niente proliferazione: è sempre lo stesso record, con la nuova scadenza.
    const all = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(occurrence.id);
    expect(all[0]!.occurrenceDate!.toISOString().slice(0, 10)).toBe(done.json().nextOccurrenceDate);

    // Cronologia: cambio di stato (NON verso "Completato") + avanzamento ricorrenza.
    const log = await prisma.activityLog.findMany({
      where: { taskId: occurrence.id },
      orderBy: { createdAt: "asc" },
    });
    expect(log.some((e) => e.action === "recurrence_advanced")).toBe(true);
    const statusEntry = log.find((entry) => entry.action === "status_changed");
    expect(statusEntry).toBeTruthy();
    expect(JSON.parse(statusEntry!.payload!).to).not.toBe("Completato");
  });

  it("completandola torna allo STATO INIZIALE scelto (non al primo di categoria)", async () => {
    // Stato iniziale scelto sul template: "Assegnato" (aperto), non il primo "Da assegnare".
    const initial = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", name: "Assegnato" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: adminCookie },
      payload: {
        title: "Con stato iniziale scelto",
        rrule: "FREQ=MONTHLY",
        dtstart: isoPlusDays(4),
        initialStatusId: initial.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const templateId = res.json().id as string;

    // Nasce già nello stato iniziale scelto.
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });
    expect(occurrence.statusId).toBe(initial.id);

    // Completandola (→ "Completato"): avanza e TORNA allo stato iniziale scelto.
    const done = await complete(occurrence.id);
    expect(done.status.id).toBe(initial.id);
    expect(done.status.isClosed).toBe(false);
    expect(done.nextOccurrenceDate).toBeTruthy();
  });

  it("stato che interrompe la ricorrenza (Annullato): non avanza e resta fermo", async () => {
    const canceled = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", name: "Annullato" },
    });
    // Marcato dalla migrazione 20260724180000_status_stops_recurrence.
    expect(canceled.stopsRecurrence).toBe(true);

    const templateId = await createTemplate({
      title: "Ricorrenza da annullare",
      rrule: "FREQ=MONTHLY",
      dtstart: isoPlusDays(6),
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });
    const originalDate = occurrence.occurrenceDate!.toISOString().slice(0, 10);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${occurrence.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: canceled.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // NON ricicla: si chiude davvero, resta in "Annullato", la scadenza non cambia.
    expect(body.status.id).toBe(canceled.id);
    expect(body.status.isClosed).toBe(true);
    expect(body.closedAt).not.toBeNull();
    expect(body.nextOccurrenceDate).toBeNull();

    const after = await prisma.task.findUniqueOrThrow({ where: { id: occurrence.id } });
    expect(after.occurrenceDate!.toISOString().slice(0, 10)).toBe(originalDate);
  });

  it("ricompletare nello stesso giorno NON somma i cicli (settimanale resta +1)", async () => {
    // Scenario reale: completo per errore, riporto il task indietro, lo ricompleto.
    // Prima l'occorrenza avanzava di 2, poi 3 settimane; deve restare +1.
    const dtstart = isoPlusDays(0); // scade oggi
    const templateId = await createTemplate({
      title: "Controllo settimanale",
      rrule: "FREQ=WEEKLY",
      dtstart,
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });
    const initialStatusId = occurrence.statusId!;
    const expected = isoPlusDays(7);

    // 1° completamento: +1 settimana.
    const first = await complete(occurrence.id);
    expect(first.nextOccurrenceDate).toBe(expected);

    // Lo riporto indietro (stato aperto qualsiasi: torna nello stato iniziale) e
    // lo ricompleto: la scadenza NON deve spostarsi ancora.
    for (let attempt = 0; attempt < 2; attempt++) {
      await app.inject({
        method: "PATCH",
        url: `/api/tasks/${occurrence.id}`,
        headers: { cookie: adminCookie },
        payload: { statusId: initialStatusId },
      });
      const again = await complete(occurrence.id);
      expect(again.nextOccurrenceDate).toBe(expected); // sempre +1, non +2/+3
    }

    // Un solo task, con la scadenza a +1 settimana.
    const all = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(all).toHaveLength(1);
    expect(all[0]!.occurrenceDate?.toISOString().slice(0, 10)).toBe(expected);
    expect(all[0]!.dueDate?.toISOString().slice(0, 10)).toBe(expected);
  });

  it("una ricorrenza rimasta indietro recupera un'occorrenza per volta", async () => {
    // Caso reale (canone mensile fermo al primo del mese): la protezione contro
    // il doppio clic bloccava anche il recupero dell'arretrato, e ogni "Fatto"
    // riportava la scadenza sempre alla stessa data. Qui la cadenza è giornaliera
    // per non dipendere dalla lunghezza dei mesi.
    const templateId = await createTemplate({
      title: "Controllo giornaliero arretrato",
      rrule: "FREQ=DAILY",
      dtstart: isoPlusDays(-3),
    });
    // Le occorrenze si materializzano da oggi in avanti: qui si riporta il task
    // indietro di tre giorni, come quando nessuno lo lavora per un po'. È la
    // situazione in cui il recupero deve funzionare.
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
      orderBy: { occurrenceDate: "asc" },
    });
    const indietro = new Date(`${isoPlusDays(-3)}T00:00:00.000Z`);
    await prisma.task.update({
      where: { id: occurrence.id },
      data: { occurrenceDate: indietro, dueDate: indietro },
    });

    // Ogni "Fatto" completa un'occorrenza vera e passa alla successiva, anche se
    // sono tutte nella stessa giornata di lavoro: si recupera l'arretrato.
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(-2));
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(-1));
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(0));
    // Arrivata a oggi, il "Fatto" successivo la porta a domani…
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(1));
    // …e da lì la protezione torna a valere: non c'è più niente da completare
    // oggi, quindi ricompletare non somma altri cicli.
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(1));
    expect((await complete(occurrence.id)).nextOccurrenceDate).toBe(isoPlusDays(1));
  });

  it("cambiare la data a mano sposta anche il posto nella serie", async () => {
    // Caso reale: completamento per sbaglio (la serie avanza), data rimessa
    // indietro a mano. Il segnaposto interno restava avanti, e il "Fatto"
    // successivo — giorni dopo — rinnovava dalla data nascosta, saltando un
    // mese. La data che si vede e il posto nella serie devono restare una cosa.
    const oggi = isoPlusDays(0);
    const templateId = await createTemplate({
      title: "Canone da rimettere indietro",
      rrule: "FREQ=MONTHLY",
      dtstart: oggi,
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });

    // Completata per sbaglio: la serie avanza di un mese (data e segnaposto).
    await complete(occurrence.id);
    const avanzato = await prisma.task.findUniqueOrThrow({ where: { id: occurrence.id } });
    expect(avanzato.occurrenceDate!.toISOString().slice(0, 10)).not.toBe(oggi);

    // La correzione a mano: si rimette la data di prima.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${occurrence.id}`,
      headers: { cookie: adminCookie },
      payload: { dueDate: oggi },
    });
    expect(res.statusCode).toBe(200);

    const corretto = await prisma.task.findUniqueOrThrow({ where: { id: occurrence.id } });
    expect(corretto.dueDate!.toISOString().slice(0, 10)).toBe(oggi);
    // Il punto della correzione: il segnaposto segue la data visibile.
    expect(corretto.occurrenceDate!.toISOString().slice(0, 10)).toBe(oggi);
  });

  it("posticipare di qualche giorno sposta la serie con la data", async () => {
    const templateId = await createTemplate({
      title: "Controllo posticipabile",
      rrule: "FREQ=MONTHLY",
      dtstart: isoPlusDays(0),
    });
    const occurrence = await prisma.task.findFirstOrThrow({
      where: { recurrenceTemplateId: templateId },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${occurrence.id}`,
      headers: { cookie: adminCookie },
      payload: { dueDate: isoPlusDays(5) },
    });
    const dopo = await prisma.task.findUniqueOrThrow({ where: { id: occurrence.id } });
    expect(dopo.occurrenceDate!.toISOString().slice(0, 10)).toBe(isoPlusDays(5));
  });

  it("registra il cambio di assegnatario con i nomi, non con gli id", async () => {
    const anna = await prisma.user.create({
      data: { email: "anna@test.local", name: "Anna Bianchi", role: UserRole.MEMBER },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Task da assegnare" },
    });
    const taskId = created.json().id as string;

    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { cookie: adminCookie },
      payload: { assigneeId: anna.id, title: "Task rinominato" },
    });

    const log = await prisma.activityLog.findMany({ where: { taskId } });
    const assignee = log.find((entry) => entry.action === "assignee_changed");
    expect(JSON.parse(assignee!.payload!)).toEqual({ from: null, to: "Anna Bianchi" });
    const renamed = log.find((entry) => entry.action === "renamed");
    expect(JSON.parse(renamed!.payload!)).toEqual({
      from: "Task da assegnare",
      to: "Task rinominato",
    });
  });
});

// Tutte le cadenze offerte dall'app (frequencyToRRule + builder): l'avanzamento
// idempotente non deve dipendere dal tipo di regola.
const ALL_RULES: Array<{ label: string; rrule: string; dtstart: string }> = [
  { label: "giornaliera", rrule: "FREQ=DAILY", dtstart: isoPlusDays(0) },
  { label: "settimanale", rrule: "FREQ=WEEKLY", dtstart: isoPlusDays(0) },
  { label: "quindicinale (2 settimane)", rrule: "FREQ=WEEKLY;INTERVAL=2", dtstart: isoPlusDays(0) },
  { label: "quindicinale (15 giorni)", rrule: "FREQ=DAILY;INTERVAL=15", dtstart: isoPlusDays(0) },
  { label: "mensile", rrule: "FREQ=MONTHLY;BYMONTHDAY=15", dtstart: "2026-01-15" },
  { label: "bimestrale", rrule: "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10", dtstart: "2026-01-10" },
  { label: "trimestrale", rrule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=12", dtstart: "2026-01-12" },
  { label: "semestrale", rrule: "FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=1", dtstart: "2026-01-01" },
  { label: "annuale", rrule: "FREQ=YEARLY", dtstart: isoPlusDays(0) },
  { label: "fine mese", rrule: "FREQ=MONTHLY;BYMONTHDAY=-1", dtstart: "2026-01-31" },
  { label: "secondo martedì", rrule: "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2", dtstart: "2026-03-10" },
];

describe("avanzamento idempotente per OGNI tipo di ricorrenza", () => {
  it.each(ALL_RULES)(
    "$label: ricompletare nello stesso giorno non sposta ulteriormente la scadenza",
    async ({ label, rrule, dtstart }) => {
      const templateId = await createTemplate({ title: `Idempotenza ${label}`, rrule, dtstart });
      const occurrence = await prisma.task.findFirstOrThrow({
        where: { recurrenceTemplateId: templateId },
      });
      const initialStatusId = occurrence.statusId!;
      const before = occurrence.occurrenceDate!.toISOString().slice(0, 10);

      // 1° completamento: la scadenza avanza.
      const first = await complete(occurrence.id);
      const advanced = first.nextOccurrenceDate as string;
      expect(advanced).toBeTruthy();
      expect(advanced).not.toBe(before);

      // Riporto indietro e ricompleto due volte: la data non deve muoversi più.
      for (let attempt = 0; attempt < 2; attempt++) {
        await app.inject({
          method: "PATCH",
          url: `/api/tasks/${occurrence.id}`,
          headers: { cookie: adminCookie },
          payload: { statusId: initialStatusId },
        });
        const again = await complete(occurrence.id);
        expect(again.nextOccurrenceDate).toBe(advanced);
      }

      // Sempre un solo task, con la scadenza del primo avanzamento.
      const all = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
      expect(all).toHaveLength(1);
      expect(all[0]!.occurrenceDate?.toISOString().slice(0, 10)).toBe(advanced);
      expect(all[0]!.dueDate?.toISOString().slice(0, 10)).toBe(advanced);
    },
  );
});

describe("completing a recurring task moves the deadline forward", () => {
  it("ricicla la cadenza annuale in place (anche oltre i 60 giorni)", async () => {
    // Cadenza annuale: la prossima scadenza cade fuori dalla vecchia finestra di
    // materializzazione, ma il task avanza comunque su sé stesso.
    const dtstart = isoPlusDays(10);
    const templateId = await createTemplate({
      title: "Dichiarazione annuale",
      rrule: "FREQ=YEARLY",
      dtstart,
    });

    const materialized = await prisma.task.findMany({
      where: { recurrenceTemplateId: templateId },
    });
    expect(materialized).toHaveLength(1);

    const body = await complete(materialized[0]!.id);
    const expected = isoPlusYear(dtstart);
    expect(body.nextOccurrenceDate).toBe(expected);

    // Sempre lo stesso task, avanzato di un anno: niente doppioni.
    const all = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(materialized[0]!.id);
    expect(all[0]!.occurrenceDate?.toISOString().slice(0, 10)).toBe(expected);
    expect(all[0]!.dueDate?.toISOString().slice(0, 10)).toBe(expected);
  });

  it("materializza UNA sola occorrenza viva per template (niente finestra 60 giorni)", async () => {
    const dtstart = isoPlusDays(5);
    const templateId = await createTemplate({
      title: "Controllo mensile",
      rrule: "FREQ=MONTHLY",
      dtstart,
    });

    const before = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(before).toHaveLength(1); // non si pre-materializzano le future

    const body = await complete(before[0]!.id);
    expect(body.nextOccurrenceDate).toBeTruthy();

    const after = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(after).toHaveLength(1); // sempre una sola, avanzata
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it("follows the calendar on end-of-month rules (31 gen → 28 feb → 31 mar)", async () => {
    const templateId = await createTemplate({
      title: "Ultimo giorno del mese",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
      dtstart: "2026-01-31",
    });

    const february = await nextDate(templateId, new Date("2026-01-31T00:00:00.000Z"));
    expect(february?.toISOString().slice(0, 10)).toBe("2026-02-28");

    const march = await nextDate(templateId, february!);
    expect(march?.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("handles leap years, quarterly and second-tuesday rules", async () => {
    const leap = await createTemplate({
      title: "Fine mese bisestile",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
      dtstart: "2028-01-31",
    });
    const february2028 = await nextDate(leap, new Date("2028-01-31T00:00:00.000Z"));
    expect(february2028?.toISOString().slice(0, 10)).toBe("2028-02-29");

    const quarterly = await createTemplate({
      title: "Trimestrale",
      rrule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=12",
      dtstart: "2026-10-12",
    });
    const nextQuarter = await nextDate(quarterly, new Date("2026-10-12T00:00:00.000Z"));
    expect(nextQuarter?.toISOString().slice(0, 10)).toBe("2027-01-12");

    const secondTuesday = await createTemplate({
      title: "Secondo martedì",
      rrule: "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
      dtstart: "2026-03-10",
    });
    const nextTuesday = await nextDate(secondTuesday, new Date("2026-03-10T00:00:00.000Z"));
    expect(nextTuesday?.toISOString().slice(0, 10)).toBe("2026-04-14");
  });

  it("regola esaurita: il task si chiude davvero, senza avanzare", async () => {
    const templateId = await createTemplate({
      title: "Una volta sola",
      rrule: "FREQ=MONTHLY;COUNT=1",
      dtstart: isoPlusDays(3),
    });
    const tasks = await prisma.task.findMany({ where: { recurrenceTemplateId: templateId } });
    expect(tasks).toHaveLength(1);

    const body = await complete(tasks[0]!.id);
    expect(body.status.isClosed).toBe(true);
    expect(body.closedAt).not.toBeNull();
    expect(body.nextOccurrenceDate).toBeNull(); // ricorrenza finita: niente più scadenze
  });

  it("leaves non-recurring tasks untouched", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "Task singolo", dueDate: isoPlusDays(2) },
    });
    expect(created.statusCode).toBe(201);

    const body = await complete(created.json().id);
    expect(body.nextOccurrenceDate).toBeUndefined();
  });
});
