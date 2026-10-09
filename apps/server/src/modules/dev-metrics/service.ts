import { ActivityCategory, EXTERNAL_ROLES, UserRole, type DevMetrics } from "@kancrm/shared";
import type { User } from "../../generated/prisma/client";
import { prisma } from "../../db";
import { devAreaMembers } from "../visibility/service";
import { workedDaysByUser } from "../hours/worked-days";
import { wipLoads } from "../task-statuses/wip";
import {
  coverage,
  hoursByProject,
  isBornClosed,
  isImportedHistory,
  lastWeeks,
  size,
  times,
  weeklyFlow,
  type ClosedTask,
} from "./dev-metrics";

/**
 * I numeri del pannello **L'andamento** ("La mia giornata").
 *
 * Il perimetro è **l'area tecnica**, e l'area di un task è quella del suo stato
 * (`TaskStatus.category`, invariante dichiarata in CLAUDE.md): niente elenco di
 * progetti "di sviluppo" da tenere aggiornato a mano.
 *
 * **Chi lavora qui dentro, non chi guarda da fuori**: un task intestato a un
 * ruolo esterno (il cliente del portale, il monitor vendite) resta fuori da
 * ogni conto. In produzione ce n'erano due su 349, e non sono lavoro della
 * squadra: facevano solo un totale che non tornava. Il **richiedente** invece
 * non c'entra — una richiesta aperta da un cliente e presa in carico da uno
 * sviluppatore è lavoro nostro a tutti gli effetti.
 *
 * Le **persone** sono i membri dei gruppi che governano l'area — la stessa
 * definizione del promemoria del timesheet — **più chi in quel periodo ha
 * chiuso lavoro tecnico**. La seconda metà non è un dettaglio: alla prima
 * misura l'amministratore non era nel gruppo Sviluppatori ma aveva chiuso 11
 * task DEV, e senza di lui i totali di squadra erano falsi.
 */

/** Finestra di osservazione: quattro settimane piene, lunedì → oggi. */
const WEEKS = 4;

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Un task **della squadra di adesso**: senza assegnatario, oppure intestato a
 * qualcuno **interno e attivo**. Restano fuori i ruoli esterni (vedi la nota in
 * cima) e chi non lavora più qui — un account spento non è una persona di cui
 * misurare il carico, e comparirebbe con zero ore e zero copertura come se
 * fosse in ritardo. Quel lavoro però **non sparisce in silenzio**: il pannello
 * lo conta a parte (`fuoriSquadra`) e lo dichiara, perché quindici task aperti
 * in mano a chi se n'è andato sono lavoro da riassegnare, non lavoro finito.
 *
 * La forma con `OR` dentro `AND` non è un vezzo: due `OR` fratelli sullo stesso
 * oggetto `where` si sovrascrivono a vicenda (trappola nota, vedi CLAUDE.md).
 */
const OWNED_BY_TEAM = {
  OR: [
    { assigneeId: null },
    { assignee: { isActive: true, role: { notIn: [...EXTERNAL_ROLES] } } },
  ],
};

export async function devMetrics(user: User, now: Date): Promise<DevMetrics> {
  const weeks = lastWeeks(now, WEEKS);
  const from = new Date(`${weeks[0]}T00:00:00.000Z`);

  const [members, closedRows, createdRows, openRows, fuoriSquadra, entries] = await Promise.all([
    devAreaMembers(),
    // Chiusi nel periodo: la data di chiusura è il fatto, lo stato di adesso no
    // (un task riaperto e richiuso resta un lavoro finito in questa finestra).
    prisma.task.findMany({
      where: {
        closedAt: { gte: from },
        status: { category: ActivityCategory.DEV },
        AND: [OWNED_BY_TEAM],
      },
      select: {
        id: true,
        assigneeId: true,
        createdAt: true,
        closedAt: true,
        project: { select: { name: true, companyId: true } },
      },
    }),
    // Entrati nel periodo: chiusi o no. La coda cresce se ne entrano più di
    // quanti ne escono, e guardare solo gli aperti nasconderebbe metà del flusso.
    prisma.task.findMany({
      where: {
        createdAt: { gte: from },
        status: { category: ActivityCategory.DEV },
        AND: [OWNED_BY_TEAM],
      },
      select: { id: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: {
        status: { category: ActivityCategory.DEV, isClosed: false },
        AND: [OWNED_BY_TEAM],
      },
      select: {
        assigneeId: true,
        dueDate: true,
        status: { select: { id: true, name: true, color: true, order: true } },
      },
    }),
    prisma.task.count({
      where: {
        status: { category: ActivityCategory.DEV, isClosed: false },
        assignee: { OR: [{ isActive: false }, { role: { in: [...EXTERNAL_ROLES] } }] },
      },
    }),
    prisma.timeEntry.findMany({
      where: { date: { gte: from } },
      select: {
        userId: true,
        hours: true,
        date: true,
        task: { select: { project: { select: { name: true, companyId: true } } } },
      },
    }),
  ]);

  // Due letture del registro attività, in due query sole (leggerlo task per
  // task sarebbe una query per riga):
  //  - la **prima traccia** di ogni task, che dice se quel record è nato qui o
  //    è stato importato con una data d'origine (vedi `isImportedHistory`);
  //  - il **primo cambio di stato**, che è la presa in carico.
  const interesting = [
    ...new Set([...closedRows.map((t) => t.id), ...createdRows.map((t) => t.id)]),
  ];
  const [firstLogs, firstChanges] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["taskId"],
      where: { taskId: { in: interesting } },
      _min: { createdAt: true },
    }),
    prisma.activityLog.groupBy({
      by: ["taskId"],
      where: { taskId: { in: closedRows.map((t) => t.id) }, action: "status_changed" },
      _min: { createdAt: true },
    }),
  ]);
  const firstLogOf = new Map(firstLogs.map((row) => [row.taskId, row._min.createdAt]));
  const firstChangeOf = new Map(firstChanges.map((row) => [row.taskId, row._min.createdAt]));

  // Le ore di un task le può registrare chiunque, e anche **prima** della
  // finestra: la taglia del lavoro è la somma di tutte, non la parte registrata
  // da chi l'ha chiuso nelle ultime quattro settimane.
  const hoursOf = new Map<string, number>();
  const taskHours = await prisma.timeEntry.groupBy({
    by: ["taskId"],
    where: { taskId: { in: closedRows.map((t) => t.id) } },
    _sum: { hours: true },
  });
  for (const row of taskHours) hoursOf.set(row.taskId, row._sum.hours ?? 0);

  const allClosed: Array<ClosedTask & { project: string | null }> = closedRows.map((task) => ({
    id: task.id,
    assigneeId: task.assigneeId,
    createdAt: task.createdAt,
    closedAt: task.closedAt!,
    firstLogAt: firstLogOf.get(task.id) ?? null,
    firstChangeAt: firstChangeOf.get(task.id) ?? null,
    hours: hoursOf.get(task.id) ?? 0,
    project: task.project?.name ?? null,
  }));
  /**
   * **Lo storico importato esce da tutto**, non solo dai tempi: contarlo tra le
   * chiusure direbbe che la squadra ne ha chiusi 155 in quattro settimane
   * quando ne ha lavorati 51, e il grafico del flusso mostrerebbe la settimana
   * dell'importazione come la più produttiva dell'anno.
   */
  const closed = allClosed.filter((task) => !isImportedHistory(task));
  const storico = allClosed.length - closed.length;
  const created = createdRows.filter(
    (task) =>
      !isImportedHistory({
        createdAt: task.createdAt,
        firstLogAt: firstLogOf.get(task.id) ?? null,
      }),
  );

  // Chi compare: il gruppo, più chi ha **chiuso** lavoro tecnico nel periodo,
  // più chi ne ha di **aperto in mano**. Le tre metà servono tutte: alla prima
  // misura l'amministratore non era nel gruppo ma aveva chiuso 11 task, e una
  // persona con 15 task aperti e nessuna chiusura sarebbe sparita dalla
  // ripartizione della coda facendone tornare male i conti.
  const known = new Map(members.map((m) => [m.id, m.name]));
  const extraIds = [
    ...new Set(
      [...closed, ...openRows]
        .map((t) => t.assigneeId)
        .filter((id): id is string => !!id && !known.has(id)),
    ),
  ];
  if (extraIds.length > 0) {
    const extra = await prisma.user.findMany({
      where: {
        id: { in: extraIds },
        isSystem: false,
        role: { in: [UserRole.ADMIN, UserRole.MEMBER] },
      },
      select: { id: true, name: true },
    });
    for (const person of extra) known.set(person.id, person.name);
  }

  const workedDaysOf = new Map<string, Set<string>>();
  const hoursByUser = new Map<string, number>();
  for (const entry of entries) {
    if (!known.has(entry.userId)) continue;
    const day = entry.date.toISOString().slice(0, 10);
    if (!workedDaysOf.has(entry.userId)) workedDaysOf.set(entry.userId, new Set());
    workedDaysOf.get(entry.userId)!.add(day);
    hoursByUser.set(entry.userId, (hoursByUser.get(entry.userId) ?? 0) + entry.hours);
  }

  /**
   * I giorni in cui ognuno ha davvero lavorato — la regola dei promemoria del
   * venerdì, presa da lì e non riscritta. È il denominatore della copertura: i
   * giorni feriali del periodo comprendono le ferie, e due settimane di
   * vacanza facevano sembrare in ritardo chi era semplicemente via.
   */
  const activeDaysOf = await workedDaysByUser([...known.keys()], from, now);
  const coverageOf = (id: string) =>
    coverage([...(workedDaysOf.get(id) ?? [])], [...(activeDaysOf.get(id) ?? [])], from, now);

  const teamEntries = entries.filter((entry) => known.has(entry.userId));
  // Vedi `oreSenzaCliente` nello schema: qui si misura un buco di anagrafica,
  // non il lavoro fatturabile.
  const senzaCliente = teamEntries
    .filter((entry) => !entry.task.project?.companyId)
    .reduce((sum, entry) => sum + entry.hours, 0);

  /**
   * **La colonna d'ingresso** dell'area: lo stato aperto con l'ordine più
   * basso ("Da fare" in sviluppo). Un task lì è assegnato ma non ancora
   * toccato; da lì in poi è in lavorazione. Si ricava dall'ordine e non dal
   * nome, che è configurabile — e coincide con la prima colonna del kanban,
   * così i due riquadri raccontano la stessa cosa.
   */
  const entryOrder = Math.min(...openRows.map((task) => task.status?.order ?? 0));
  const isTodo = (task: (typeof openRows)[number]) => task.status?.order === entryOrder;

  // Una domanda sola invece di due: la stessa risposta decide la tabella delle
  // persone e l'elenco dei limiti in sofferenza.
  const guida = await governsDevArea(user);
  // Due dates are date-only, at midnight UTC: late means due before today.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mine = closed.filter((task) => task.assigneeId === user.id);
  const openQueue = new Map<string, { id: string; name: string; color: string; count: number }>();
  for (const task of openRows) {
    if (!task.status) continue;
    const row = openQueue.get(task.status.id) ?? { ...task.status, count: 0 };
    row.count += 1;
    openQueue.set(task.status.id, row);
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    weeks: weeklyFlow(
      created.map((task) => task.createdAt),
      closed.map((task) => task.closedAt),
      weeks,
    ),
    team: {
      aperti: openRows.length,
      chiusi: closed.length,
      storico,
      coda: [...openQueue.values()].sort((a, b) => b.count - a.count),
      tempi: times(closed),
      taglia: size(closed),
      orePerProgetto: hoursByProject(
        teamEntries.map((entry) => ({
          project: entry.task.project?.name ?? null,
          hours: entry.hours,
        })),
      ).slice(0, 8),
      oreSenzaCliente: round(senzaCliente),
      nonAssegnati: openRows.filter((task) => !task.assigneeId).length,
      nonAssegnatiDaFare: openRows.filter((task) => !task.assigneeId && isTodo(task)).length,
      fuoriSquadra,
    },
    me: {
      aperti: openRows.filter((task) => task.assigneeId === user.id).length,
      chiusi: mine.length,
      natiChiusi: mine.filter(isBornClosed).length,
      tempi: times(mine),
      taglia: size(mine),
      ore: round(hoursByUser.get(user.id) ?? 0),
      copertura: coverageOf(user.id),
    },
    // Il quadro della squadra lo legge chi la guida. **In ordine alfabetico**:
    // ordinarlo per ore o per task chiusi ne farebbe una classifica, ed è
    // esattamente ciò che questi numeri non devono diventare.
    // Fuori dalla finestra temporale e fuori dall'area: un limite superato è una
    // cosa di **adesso** — "quattro cose aperte insieme" non ha un periodo — e
    // vale in qualunque progetto, non solo in quelli tecnici.
    wip: guida ? await wipLoads() : null,
    people: guida
      ? [...known.entries()]
          .map(([id, name]) => ({
            id,
            name,
            assegnati: openRows.filter((task) => task.assigneeId === id).length,
            inRitardo: openRows.filter(
              (task) => task.assigneeId === id && task.dueDate !== null && task.dueDate < today,
            ).length,
            daFare: openRows.filter((task) => task.assigneeId === id && isTodo(task)).length,
            inCorso: openRows.filter((task) => task.assigneeId === id && !isTodo(task)).length,
            chiusi: closed.filter((task) => task.assigneeId === id).length,
            ore: round(hoursByUser.get(id) ?? 0),
            copertura: coverageOf(id).percento,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null,
  };
}

/** Chi governa l'area tecnica: un admin elevato o il manager di un gruppo DEV. */
export async function governsDevArea(user: User): Promise<boolean> {
  if (user.role === UserRole.ADMIN) return true;
  const managed = await prisma.groupMember.count({
    where: { userId: user.id, isManager: true, group: { managedArea: ActivityCategory.DEV } },
  });
  return managed > 0;
}

/**
 * Chi vede il pannello: chi **lavora** nell'area tecnica o chi la **governa**.
 * È la stessa appartenenza del promemoria del timesheet — un campo nuovo da
 * tenere allineato sarebbe la solita seconda verità.
 */
export async function canSeeDevMetrics(user: User): Promise<boolean> {
  if (user.role === UserRole.PORTAL || user.role === UserRole.SALES_MONITOR) return false;
  if (await governsDevArea(user)) return true;
  return (await devAreaMembers()).some((member) => member.id === user.id);
}
