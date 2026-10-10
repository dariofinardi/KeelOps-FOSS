// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/*
 * The timesheet grid: the core part, in every edition (08/10/2026). The grid of
 * a month or a week with the task picker, one cell at a time, a row added or
 * removed by hand, the month lock, and the monthly summaries. The commercial
 * edition adds suggestions, automatic rows, reports, productivity and exports
 * (timesheet/routes.ts).
 */
import type { FastifyInstance } from "fastify";
import {
  EXTERNAL_ROLES,
  SummaryGroupBy,
  UserRole,
  monthString,
  periodString,
  upsertTimeEntrySchema,
  type TimesheetMonth,
  type TimesheetRow,
  type TimesheetSummaryRow,
  type TimesheetTaskPage,
} from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest, forbidden } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { assertTaskViewAccess } from "../tasks/routes";
import { canViewTeamTimesheet, timesheetPeopleIds } from "../visibility/service";
import { visibleTaskWhere } from "../visibility/task-perimeter";
import { haModulo } from "../../edition/registry";
import type { User } from "../../generated/prisma/client";
import { orderByLastTouch } from "./recent-tasks";
import { upsertTimeEntry } from "./entry-service";
import { BOOKKEEPING_ACTIONS } from "./work-actions";
import {
  rangeOf,
  pinPeriodWhere,
  isPeriodLocked,
  periodInput,
  periodOf,
  assertPeriodOpen,
  taskRefInclude,
  contextLabel,
  toTaskRef,
  accessibleEntriesWhere,
} from "./helpers";

/** The commercial timesheet module is there (suggestions, reports, productivity…). */
const timesheetCompleto = () => haModulo("timesheet");

/**
 * Who sees the summaries (by task, by person, by project). In the commercial
 * edition everyone does, within the hours they may see (accessibleEntriesWhere):
 * unchanged. In the community edition only the managers — whoever may browse
 * other people's hours (canViewTeamTimesheet) — as decided on 08/10/2026.
 */
async function assertMaySeeSummaries(user: User): Promise<void> {
  if (timesheetCompleto()) return;
  if (!(await canViewTeamTimesheet(user))) {
    throw forbidden("I riepiloghi delle ore sono riservati ai manager");
  }
}

export function hoursRoutes(app: FastifyInstance): void {
  // Griglia del periodo: righe = task con ore nel mese o nella settimana.
  app.get("/api/timesheet", async (request) => {
    const user = requireUser(request);
    const query = periodInput
      .extend({ userId: z.string().optional(), userIds: z.string().optional() })
      .parse(request.query);
    const period = periodOf(query);

    // userIds (multi) ha la precedenza; userId (singolo) resta per compatibilità.
    const requested =
      query.userIds !== undefined
        ? query.userIds.split(",").filter(Boolean)
        : query.userId
          ? [query.userId]
          : [];
    // Nessuna selezione, o solo sé stessi = il proprio timesheet (modificabile).
    const isSelfOnly =
      requested.length === 0 || (requested.length === 1 && requested[0] === user.id);
    const targetIds = isSelfOnly ? [user.id] : requested;

    const { from, to } = rangeOf(period);
    const entries = await prisma.timeEntry.findMany({
      // Il proprio timesheet è sempre completo; per gli altri vale la visibilità dei
      // riepiloghi (admin/permesso = tutto, manager = propri progetti, ecc.).
      where: {
        userId: { in: targetIds },
        date: { gte: from, lt: to },
        ...(isSelfOnly ? {} : accessibleEntriesWhere(user)),
      },
      include: { task: { include: taskRefInclude } },
    });

    // Con più utenti la cella somma le ore di tutti (griglia aggregata, sola lettura).
    const rowsByTask = new Map<string, TimesheetRow>();
    // La data di modifica serve all'ordinamento per ultimo tocco (sotto): si
    // annota qui, prima che toTaskRef la lasci per strada.
    const updatedAtByTask = new Map<string, Date>();
    for (const entry of entries) {
      const row = rowsByTask.get(entry.taskId) ?? {
        task: toTaskRef(entry.task),
        entries: {},
        total: 0,
      };
      const day = entry.date.toISOString().slice(0, 10);
      row.entries[day] = (row.entries[day] ?? 0) + entry.hours;
      row.total += entry.hours;
      rowsByTask.set(entry.taskId, row);
      updatedAtByTask.set(entry.taskId, entry.task.updatedAt);
    }
    // Righe tenute a mano: chi pianifica mette in griglia i task su cui dovrà
    // lavorare e li ritrova al rientro, anche a zero ore. Valgono solo sul
    // proprio timesheet — sono una comodità personale, non un dato condiviso.
    if (isSelfOnly) {
      const pins = await prisma.timesheetPin.findMany({
        where: { userId: user.id, task: { deletedAt: null }, ...pinPeriodWhere(period) },
        include: { task: { include: taskRefInclude } },
      });
      for (const pin of pins) {
        updatedAtByTask.set(pin.taskId, pin.task.updatedAt);
        if (rowsByTask.has(pin.taskId)) continue;
        rowsByTask.set(pin.taskId, { task: toTaskRef(pin.task), entries: {}, total: 0 });
      }
    }
    // Il proprio timesheet mette in alto ciò su cui si è lavorato per ultimo —
    // la stessa regola della tendina (orderByLastTouch): chi apre la griglia sta
    // rendicontando il lavoro appena fatto, non consultando un archivio.
    // L'aggregato multi-utente resta alfabetico: quello SI consulta come elenco.
    let rows: TimesheetRow[];
    if (isSelfOnly && rowsByTask.size > 0) {
      const myActivity = await prisma.activityLog.groupBy({
        by: ["taskId"],
        where: { userId: user.id, taskId: { in: [...rowsByTask.keys()] } },
        _max: { createdAt: true },
      });
      const myLastTouch = new Map(myActivity.map((row) => [row.taskId, row._max.createdAt]));
      const ordered = orderByLastTouch(
        [...rowsByTask.keys()].map((id) => ({
          id,
          updatedAt: updatedAtByTask.get(id) ?? new Date(0),
        })),
        myLastTouch,
      );
      rows = ordered.map((task) => rowsByTask.get(task.id)!);
    } else {
      rows = [...rowsByTask.values()].sort((a, b) =>
        `${a.task.context} ${a.task.title}`.localeCompare(`${b.task.context} ${b.task.title}`),
      );
    }

    const locked = await isPeriodLocked(period);
    const result: TimesheetMonth = {
      period,
      userId: isSelfOnly ? user.id : targetIds.join(","),
      editable: isSelfOnly && !locked,
      locked,
      rows,
      total: rows.reduce((sum, row) => sum + row.total, 0),
      // La griglia degli altri può essere passata dal filtro dei riepiloghi:
      // va detto in pagina, o "vedo poco" e "non c'è niente" sono
      // indistinguibili — ed è un admin non elevato il primo a cascarci.
      filtered: !isSelfOnly && user.role !== UserRole.ADMIN && !user.canViewAllTimesheets,
    };
    return result;
  });

  // Upsert di una cella (ore = 0 elimina la registrazione).
  app.put("/api/timesheet/entry", async (request) => {
    const user = requireUser(request);
    const input = upsertTimeEntrySchema.parse(request.body);
    return upsertTimeEntry(user, input);
  });

  /**
   * Tiene un task nella griglia del mese anche senza ore.
   *
   * Aggiungere una riga era un fatto del solo browser: al primo ricaricamento
   * spariva, e chi si prepara la settimana con i task da lavorare la ritrovava
   * vuota. Ora la scelta è registrata, per utente e per mese.
   */
  app.post("/api/timesheet/rows", async (request, reply) => {
    const user = requireUser(request);
    const input = periodInput.extend({ taskId: z.string() }).parse(request.body);
    const { taskId } = input;
    const period = periodOf(input);
    await assertPeriodOpen(period);

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.deletedAt) throw badRequest("Task non valido");
    // Stessa regola dell'imputazione: si tiene in griglia ciò che si può vedere.
    await assertTaskViewAccess(user, task);

    await prisma.timesheetPin.upsert({
      where: { userId_taskId_period: { userId: user.id, taskId, period } },
      update: {},
      create: { userId: user.id, taskId, period },
    });
    return reply.status(201).send({ taskId, period });
  });

  // Elimina un'intera riga della griglia: tutte le proprie ore del task nel mese,
  // e la riga tenuta a mano (altrimenti tornerebbe vuota al ricaricamento).
  app.delete("/api/timesheet/rows/:taskId", async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const period = periodOf(periodInput.parse(request.query));
    await assertPeriodOpen(period);
    const { from, to } = rangeOf(period);
    await prisma.timeEntry.deleteMany({
      where: { userId: user.id, taskId, date: { gte: from, lt: to } },
    });
    // Togliendo la riga sparisce anche il "tienila in griglia" del periodo —
    // guardando il mese anche quelli delle sue settimane, o la riga tornerebbe
    // vuota al ricaricamento.
    await prisma.timesheetPin.deleteMany({
      where: { userId: user.id, taskId, ...pinPeriodWhere(period) },
    });
    return reply.status(204).send();
  });

  /**
   * Task da aggiungere alla griglia, a blocchi.
   *
   * Senza ricerca l'elenco parte da quello che l'utente ha davvero in mano — i
   * task che gli sono assegnati o di cui è referente — **dall'ultimo toccato in
   * giù** (`recent-tasks.ts`): chi apre questa tendina sta imputando le ore di
   * oggi, e le ore di oggi stanno su quello che ha appena lavorato. In ordine
   * alfabetico, con ottanta voci, la prima utile non si vedeva mai.
   *
   * Appena scrive qualcosa la ricerca si allarga a **tutto quello che può
   * vedere** (i progetti di cui è membro, e lo scadenzario o le offerte se ne ha
   * il permesso), perché le ore si possono mettere su qualunque task visibile —
   * e lì l'ordine torna alfabetico: si sta cercando un nome, e l'insieme è
   * troppo grande per pesarlo tutto.
   */
  app.get("/api/timesheet/visible-tasks", async (request) => {
    const user = requireUser(request);
    const { q, skip, period } = z
      .object({
        q: z.string().optional(),
        skip: z.coerce.number().int().min(0).default(0),
        /** Periodo mostrato in griglia: decide cosa proporre senza cercare. */
        period: periodString.optional(),
      })
      .parse(request.query);
    const take = 30;

    // Stesso perimetro della ricerca globale (modulo condiviso): le ore si
    // mettono su qualunque task visibile, e "visibile" deve voler dire la
    // stessa cosa ovunque.
    const perimeter = await visibleTaskWhere(user);
    if (!perimeter) return { items: [], hasMore: false } satisfies TimesheetTaskPage;

    const search = q?.trim() ?? "";
    if (search) {
      const tasks = await prisma.task.findMany({
        // Niente filtro sui chiusi: si finisce un lavoro, lo si chiude e POI si
        // registrano le ore — cercarlo per nome e non trovarlo è il motivo per
        // cui certi task restavano senza ore (14/08/2026). Lo stesso principio
        // che "compila dalle attività" applica da sempre.
        where: { AND: [perimeter, { title: { contains: search } }] },
        include: taskRefInclude,
        orderBy: { title: "asc" },
        skip,
        take: take + 1,
      });
      return {
        items: tasks.slice(0, take).map(toTaskRef),
        hasMore: tasks.length > take,
      } satisfies TimesheetTaskPage;
    }

    /**
     * Senza cercare si propone **ciò su cui si sta lavorando nel periodo**
     * mostrato in griglia (15/08/2026): i task toccati davvero — un commento,
     * un cambio di stato, un allegato — più quelli su cui ci sono già delle ore.
     *
     * Un task assegnato e mai toccato **non** compare: assegnare è un gesto di
     * qualcun altro, e la tendina si riempiva di lavoro che non è ancora
     * cominciato. Se serve prima di averci messo mano, lo si cerca per nome: la
     * ricerca vede tutto il perimetro, i propri task e quelli dei colleghi.
     */
    if (period) {
      const { from, to } = rangeOf(period);
      const [touched, logged] = await Promise.all([
        prisma.activityLog.groupBy({
          by: ["taskId"],
          where: {
            userId: user.id,
            createdAt: { gte: from, lt: to },
            action: { notIn: BOOKKEEPING_ACTIONS },
          },
          _max: { createdAt: true },
        }),
        prisma.timeEntry.groupBy({
          by: ["taskId"],
          where: { userId: user.id, date: { gte: from, lt: to } },
        }),
      ]);
      const comments = await prisma.comment.groupBy({
        by: ["taskId"],
        where: { authorId: user.id, createdAt: { gte: from, lt: to } },
        _max: { createdAt: true },
      });
      const lastTouch = new Map<string, Date>();
      for (const row of [...touched, ...comments]) {
        const when = row._max.createdAt;
        if (!when) continue;
        const previous = lastTouch.get(row.taskId);
        if (!previous || previous < when) lastTouch.set(row.taskId, when);
      }
      const ids = [...new Set([...lastTouch.keys(), ...logged.map((row) => row.taskId)])];
      if (ids.length === 0) return { items: [], hasMore: false } satisfies TimesheetTaskPage;

      // Il perimetro vale anche qui: si è potuto commentare un task che oggi
      // non si vede più (uscita da un progetto), e non va riproposto.
      const visible = await prisma.task.findMany({
        where: { AND: [perimeter, { id: { in: ids } }] },
        include: taskRefInclude,
      });
      const ordered = visible.sort(
        (a, b) =>
          (lastTouch.get(b.id)?.getTime() ?? b.updatedAt.getTime()) -
          (lastTouch.get(a.id)?.getTime() ?? a.updatedAt.getTime()),
      );
      return {
        items: ordered.slice(skip, skip + take).map(toTaskRef),
        hasMore: ordered.length > skip + take,
      } satisfies TimesheetTaskPage;
    }

    // Senza periodo (chiamata vecchia, o altro consumatore): i propri task,
    // ordinati per ultimo tocco.
    // Anche qui i chiusi restano: l'ordine è per ultimo tocco, quindi quello
    // appena chiuso sta in cima — che è esattamente il task su cui si stanno
    // per mettere le ore.
    const own = await prisma.task.findMany({
      where: { AND: [perimeter, { OR: [{ assigneeId: user.id }, { supervisorId: user.id }] }] },
      select: { id: true, updatedAt: true },
    });
    const myActivity = own.length
      ? await prisma.activityLog.groupBy({
          by: ["taskId"],
          where: { userId: user.id, taskId: { in: own.map((task) => task.id) } },
          _max: { createdAt: true },
        })
      : [];
    const myLastTouch = new Map(myActivity.map((row) => [row.taskId, row._max.createdAt]));
    const ordered = orderByLastTouch(own, myLastTouch);

    const pageIds = ordered.slice(skip, skip + take).map((task) => task.id);
    const page = await prisma.task.findMany({
      where: { id: { in: pageIds } },
      include: taskRefInclude,
    });
    // `findMany` non conserva l'ordine degli id chiesti: lo si rimette.
    const byId = new Map(page.map((task) => [task.id, task]));
    return {
      items: pageIds.flatMap((id) => {
        const task = byId.get(id);
        return task ? [toTaskRef(task)] : [];
      }),
      hasMore: ordered.length > skip + take,
    } satisfies TimesheetTaskPage;
  });

  // Chiusura/riapertura mese (solo admin): blocca ogni modifica alle ore del mese.
  app.put("/api/timesheet/locks/:month", async (request) => {
    const user = requireUser(request);
    if (user.role !== UserRole.ADMIN) {
      throw forbidden("Solo l'admin può chiudere o riaprire un mese");
    }
    const month = monthString.parse((request.params as { month: string }).month);
    const { locked } = z.object({ locked: z.boolean() }).parse(request.body);
    if (locked) {
      await prisma.timesheetLock.upsert({
        where: { month },
        update: {},
        create: { month, lockedById: user.id },
      });
    } else {
      await prisma.timesheetLock.deleteMany({ where: { month } });
    }
    return { month, locked };
  });

  // Riepiloghi: proprie ore + task supervisionati + progetti dove si è MANAGER.
  app.get("/api/timesheet/summary", async (request) => {
    const user = requireUser(request);
    const query = periodInput
      .extend({ groupBy: z.nativeEnum(SummaryGroupBy) })
      .parse(request.query);
    await assertMaySeeSummaries(user);
    const { from, to } = rangeOf(periodOf(query));

    const entries = await prisma.timeEntry.findMany({
      where: { date: { gte: from, lt: to }, ...accessibleEntriesWhere(user) },
      include: { user: true, task: { include: { project: true } } },
    });

    // Per task si raggruppa sull'id, non sul titolo: due task diversi possono
    // chiamarsi allo stesso modo in progetti diversi ("Test e bug fixing"), e
    // sommarli insieme faceva sparire proprio l'informazione che si sta cercando.
    const byKey = new Map<string, TimesheetSummaryRow>();
    for (const entry of entries) {
      const ref = { id: entry.task.id, title: entry.task.title, context: contextLabel(entry.task) };
      const [key, label, context] =
        query.groupBy === SummaryGroupBy.USER
          ? // Chiave = id (come per i task): due omonimi sono due persone.
            [entry.userId, entry.user.name, null]
          : query.groupBy === SummaryGroupBy.TASK
            ? [entry.taskId, ref.title, ref.context]
            : [ref.context, ref.context, null];
      const row = byKey.get(key) ?? { label, hours: 0, context };
      row.hours += entry.hours;
      byKey.set(key, row);
    }
    const rows: TimesheetSummaryRow[] = [...byKey.values()].sort(
      (a, b) => b.hours - a.hours || a.label.localeCompare(b.label, "it"),
    );
    return rows;
  });

  // Persone selezionabili: interne attive più chiunque abbia registrato ore (anche
  // disattivato, es. chi ha lasciato l'azienda) — ristrette a quelle di cui si
  // possono davvero sfogliare le ore. Chi non ne ha nessuna riceve sé stesso e
  // basta, così la tendina non promette quello che non può mostrare.
  app.get("/api/timesheet/users", async (request) => {
    const user = requireUser(request);
    if (!(await canViewTeamTimesheet(user))) {
      throw forbidden("Non hai accesso ai timesheet del team");
    }
    const visibleIds = await timesheetPeopleIds(user);
    // groupBy → GROUP BY in SQL: il distinct di findMany deduplica in memoria,
    // e qui vorrebbe dire scaricare l'intera tabella delle ore a ogni apertura.
    const withEntries = await prisma.timeEntry.groupBy({ by: ["userId"] });
    const ids = withEntries.map((e) => e.userId);
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { OR: [{ isActive: true, role: { notIn: [...EXTERNAL_ROLES] } }, { id: { in: ids } }] },
          ...(visibleIds ? [{ id: { in: visibleIds } }] : []),
        ],
      },
      select: { id: true, name: true, isActive: true },
    });
    // Attivi prima, poi per nome.
    users.sort(
      (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "it"),
    );
    return users;
  });

  // Ripartizione ore per progetto con dettaglio per persona (accordion), con filtro
  // opzionale sugli utenti (multi-selezione). Rispetta la visibilità dei riepiloghi.
  app.get("/api/timesheet/breakdown", async (request) => {
    const user = requireUser(request);
    const query = periodInput.extend({ userIds: z.string().optional() }).parse(request.query);
    await assertMaySeeSummaries(user);
    const { from, to } = rangeOf(periodOf(query));
    const userIds = query.userIds ? query.userIds.split(",").filter(Boolean) : null;

    const entries = await prisma.timeEntry.findMany({
      where: {
        date: { gte: from, lt: to },
        ...accessibleEntriesWhere(user),
        ...(userIds ? { userId: { in: userIds } } : {}),
      },
      include: { user: true, task: { include: { project: true } } },
    });

    type Person = { name: string; isActive: boolean; hours: number };
    const byProject = new Map<string, { hours: number; people: Map<string, Person> }>();
    for (const entry of entries) {
      const label = contextLabel(entry.task);
      const group = byProject.get(label) ?? { hours: 0, people: new Map<string, Person>() };
      group.hours += entry.hours;
      const person = group.people.get(entry.userId) ?? {
        name: entry.user.name,
        isActive: entry.user.isActive,
        hours: 0,
      };
      person.hours += entry.hours;
      group.people.set(entry.userId, person);
      byProject.set(label, group);
    }

    return [...byProject.entries()]
      .map(([label, group]) => ({
        label,
        hours: group.hours,
        people: [...group.people.entries()]
          .map(([userId, p]) => ({ userId, name: p.name, isActive: p.isActive, hours: p.hours }))
          .sort((a, b) => b.hours - a.hours),
      }))
      .sort((a, b) => b.hours - a.hours);
  });
}
