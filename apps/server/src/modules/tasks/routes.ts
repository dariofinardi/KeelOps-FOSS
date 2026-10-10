// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import {
  unlockSecretCommentSchema,
  ACTIVITY_CATEGORY_ORDER,
  ActivityCategory,
  NotificationType,
  TaskKind,
  UserRole,
  VisibilityScope,
  createCommentSchema,
  createTaskSchema,
  moduleCategory,
  statusCategoryOf,
  taskFiltersSchema,
  updateTaskSchema,
  dueRangeEnd,
  type TaskFilters,
} from "@kancrm/shared";
import { prisma } from "../../db";
import type { Prisma } from "../../generated/prisma/client";
import { csvCell } from "../../lib/csv";
import { badRequest, forbidden, notFound } from "../../lib/http-errors";
import { perUtente } from "../../lib/rate-limit";
import { requireAdmin, requireUser } from "../../plugins/auth";
import { localeFromRequest } from "../../i18n";
import { logActivity } from "./activity";
import { evaluateTaskAccess, taskAccessContext } from "./permissions";
import {
  activityInclude,
  commentInclude,
  taskListInclude,
  toActivityDto,
  toCommentDto,
  toTaskDetail,
  toTaskListItem,
} from "./serializers";
import { canSeeScope, manageableCategories } from "../visibility/service";
import { visibleTaskWhere } from "../visibility/task-perimeter";
import { softDeleteTask } from "../trash/service";
import { assertProjectView } from "../projects/access";
import { findMentionedUserIds, notifyMany } from "../notifications/service";
import { agganciTask, type AggancioCommento } from "./lifecycle-hooks";
import {
  hasReservedToken,
  hasUserToken,
  stripReservedToken,
  stripUserToken,
} from "./chat-keywords";
import {
  messaggiVisibiliA,
  messaggioVisibileA,
  nascostoAChiStaFuori,
  puoCifrare,
  staFuori,
} from "./comment-visibility";
import { dettaglioPerChiGuarda } from "./comment-counts";

// I controlli di accesso vivono in ./access; il re-export mantiene stabili gli
// import degli altri moduli (meetings, attachments, timesheet).
import { assertTaskEditAccess, assertTaskViewAccess } from "./access";
import { ensureMeeting, loadTaskDetail } from "./common";
import { applyTaskUpdate } from "./update-service";
import { createTaskAs } from "./create";
import {
  decryptSecretBody,
  encryptSecretBody,
  hasSecretToken,
  stripSecretToken,
} from "./secret-comments";
import { verifyPassword } from "../auth/password";
import {
  ChallengeType,
  createOtpChallenge,
  inCooldown,
  verifyOtpChallenge,
} from "../auth/challenges";
import { sendUnlockCodeEmail } from "../mail/service";
import { closedTaskWhere } from "./closed";
import { nextCopyTitle, stripCopySuffix } from "./duplicate";
import { companyIdOf, companyIdSelect, companyNameWhere, companyWhere } from "./company";

export { assertTaskEditAccess, assertTaskViewAccess } from "./access";
export { loadTaskDetail } from "./common";

/** Query dei timeline lazy (commenti/attività): cursore opzionale + limite 1..100 (def. 20). */
function parseTimelineQuery(query: unknown): { cursor?: string; limit: number } {
  const q = (query ?? {}) as { cursor?: string; limit?: string };
  const cursor = typeof q.cursor === "string" && q.cursor !== "" ? q.cursor : undefined;
  const n = Number(q.limit);
  const limit = Number.isFinite(n) ? Math.min(100, Math.max(1, Math.trunc(n))) : 20;
  return { cursor, limit };
}

/**
 * Where dei filtri della lista task: UNICO punto per lista e facet.
 *
 * L'export CSV NON passa di qui, per scelta (06/08/2026): è uno scarico grezzo
 * con i soli filtri di base, non una fotografia della tabella — vedi il
 * commento sull'endpoint. Tutto il resto che "mostra la lista" deve usare
 * questa funzione, non riscriverla.
 */
/**
 * Filtro per area di lavoro: la regola di `statusCategoryOf`, scritta come
 * where. Vince il tipo di mestiere; i tipi Generali e i task senza tipo
 * ricadono nella categoria del modulo (scadenzario → amministrativa, progetti
 * → sviluppo). In OR, quindi va composto in AND con il resto.
 */
function categoryWhere(category: ActivityCategory, kinds: TaskKind[]) {
  // I moduli la cui area coincide: lì anche "senza tipo" e i Generali contano.
  const ownModules = kinds.filter((kind) => moduleCategory(kind) === category);
  return {
    OR: [
      { activityType: { category } },
      ...(ownModules.length > 0
        ? [
            {
              kind: { in: ownModules },
              OR: [
                { activityTypeId: null },
                { activityType: { category: ActivityCategory.GENERAL } },
              ],
            },
          ]
        : []),
    ],
  };
}

/** Le tendine (e i loro numeri): ognuna si conta SENZA il proprio filtro. */
type FacetKey = "status" | "assignee" | "type" | "area" | "company";

/**
 * Il where della lista, con la possibilità di **escludere un filtro**.
 *
 * Serve ai numeri delle tendine: "Dario Ferri (41)" accanto a una tabella con
 * 4 righe non si capisce (11/08/2026). Ogni tendina si conta applicando tutti
 * gli ALTRI filtri ma non il proprio — così il numero dice quanti task vedresti
 * scegliendo quella voce, e la tendina non si svuota da sé quando la si usa.
 */
function taskFiltersWhere(
  filters: TaskFilters,
  base: Prisma.TaskWhereInput,
  listKinds: TaskKind[],
  except?: FacetKey,
) {
  // L'AND che arriva dal `base` va CONSERVATO, non sostituito: lì dentro c'è il
  // perimetro dei permessi del riepilogo. Scrivendo `...base` e poi `AND: [...]`
  // l'oggetto perdeva la chiave precedente, e scegliere un'area spegneva il
  // perimetro — la lista mostrava i task di tutti (e dei progetti archiviati)
  // mentre i numeri delle tendine, che il filtro d'area non ce l'hanno, restavano
  // giusti: è da lì che veniva l'incoerenza vista in pagina (11/08/2026).
  const baseAnd = Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : [];
  const areaClause =
    filters.category && except !== "area" ? [categoryWhere(filters.category, listKinds)] : [];
  // Il cliente arriva da più relazioni, quindi è un `OR`: va nell'AND, o si
  // sovrascriverebbe con l'`OR` della ricerca per testo qui sotto.
  const companyClause =
    filters.companyId && except !== "company" ? [companyWhere(filters.companyId)] : [];
  /**
   * Range di scadenza: gli **scaduti**, quelli **entro N giorni**, e quelli
   * **senza data** (10/09/2026 — prima i senza data restavano fuori, e in una
   * bacheca kanban sparivano dalle colonne come se fossero stati cancellati).
   *
   * Va nell'`AND` e non come chiave `OR` di primo livello: lì l'`OR` c'è già,
   * quello della ricerca per testo, e due `OR` fratelli nello stesso oggetto si
   * sovrascrivono — è la stessa trappola per cui il filtro cliente sta qui.
   */
  const dueClause = filters.dueWithinDays
    ? [
        {
          OR: [
            {
              dueDate: {
                lte: new Date(
                  `${dueRangeEnd(new Date().toISOString().slice(0, 10), filters.dueWithinDays)}T00:00:00.000Z`,
                ),
              },
            },
            { dueDate: null },
          ],
        },
      ]
    : [];
  const and = [...baseAnd, ...areaClause, ...companyClause, ...dueClause];
  return {
    // I task di board (boardId valorizzato, statusId null) hanno una vista propria
    // (/api/boards/:id/tasks): fuori dallo scadenzario, o crasherebbero i serializer.
    boardId: null,
    ...base,
    ...(and.length > 0 ? { AND: and } : {}),
    ...(filters.statusId && except !== "status" ? { statusId: filters.statusId } : {}),
    ...(filters.assigneeId && except !== "assignee" ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.activityTypeId && except !== "type"
      ? { activityTypeId: filters.activityTypeId }
      : {}),
    ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
    // Anche per **cliente**: "bore" deve trovare il task di "Cornucopia /
    // Boreal" (20/08/2026). La ricerca globale lo faceva già e questa no — il
    // nome del cliente è scritto sulla card, quindi cercarlo e non trovare
    // niente si legge come un record sparito, non come un campo non indicizzato.
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q } },
            { description: { contains: filters.q } },
            companyNameWhere(filters.q),
          ],
        }
      : {}),
    ...closedTaskWhere(filters),
  };
}

export function taskRoutes(app: FastifyInstance): void {
  app.get("/api/tasks", async (request) => {
    const user = requireUser(request);
    const filters = taskFiltersSchema.parse(request.query);

    // Scadenzario: senza scope si vedono solo i propri task (personale); con lo
    // scope si vede tutto lo scadenzario. Nei progetti conta la membership.
    let seesAllAdmin = true;
    // Chi vede il progetto solo perché ci ha del lavoro (referente di una
    // consegna, per esempio) vede i propri task, non la bacheca altrui.
    let onlyOwnProjectTasks = false;
    if (filters.projectId) {
      onlyOwnProjectTasks = (await assertProjectView(user, filters.projectId)).onlyOwnTasks;
    } else {
      seesAllAdmin = await canSeeScope(user, VisibilityScope.ADMIN_TASKS);
    }

    // In AND per non collidere con l'OR della ricerca testuale.
    // I permessi valgono SEMPRE, anche per le facet: quelle dicono cosa si può
    // scegliere, e non devono promettere task che l'utente non vedrebbe.
    const permissionFilters = [];
    if ((!filters.projectId && !seesAllAdmin) || onlyOwnProjectTasks) {
      // I propri, più quelli dell'AREA che si governa da manager: la stessa
      // regola che decide per-record (`readsAsAreaManager`), scritta come
      // filtro. Senza, il manager apriva un task della sua area ma non lo
      // trovava in nessun elenco.
      const managedAreas = [...(await manageableCategories(user))];
      permissionFilters.push({
        OR: [
          { assigneeId: user.id },
          { supervisorId: user.id },
          /**
           * Averlo creato conta — un task aperto per un collega resta tuo da
           * seguire — **tranne quando è una richiesta**: quella si è aperta
           * dall'area ticket, dove la si legge e le si risponde, e ricomparire
           * dentro il progetto vuol dire vedere due volte la stessa cosa in
           * due posti diversi. Su Atlante erano otto richieste in mezzo a
           * centoundici task veri (20/08/2026).
           *
           * Solo qui, dentro un progetto: nel perimetro generale il creatore
           * resta, o chi apre una richiesta senza avere l'area ticket non la
           * troverebbe più nemmeno cercandola.
           */
          { AND: [{ creatorId: user.id }, { createdViaTicket: false }] },
          ...(managedAreas.length > 0 ? [{ status: { category: { in: managedAreas } } }] : []),
        ],
      });
    }
    /**
     * Quali record entrano in gioco, prima dei filtri scelti dall'utente:
     *  - dentro un progetto, i suoi task;
     *  - **riepilogo del proprio lavoro** (Bacheche, 11/08/2026): scadenzario
     *    PIÙ i task di progetto **su cui si lavora** (assegnatario o
     *    supervisore), così il lavoro tecnico si legge senza entrare progetto
     *    per progetto — ma senza tirarsi dentro le bacheche altrui. Il
     *    perimetro è quello condiviso, che sa già chi vede cosa: lì la
     *    restrizione "solo i miei" non va riapplicata;
     *  - altrimenti il solo scadenzario, com'è sempre stato.
     * I subtask restano fuori: stanno sotto il loro padre, non in un elenco piatto.
     */
    const wide = !filters.projectId && filters.includeProjectTasks === true;
    const listKinds = filters.projectId
      ? [TaskKind.PROJECT]
      : wide
        ? [TaskKind.ADMIN, TaskKind.PROJECT]
        : [TaskKind.ADMIN];
    let base: Prisma.TaskWhereInput;
    if (filters.projectId) {
      base = { kind: TaskKind.PROJECT, projectId: filters.projectId };
    } else if (wide) {
      // Riepilogo del PROPRIO lavoro: i task di progetto entrano solo se
      // assegnati o supervisionati (la bacheca di un progetto si guarda dalla
      // pagina del progetto — essere membri di venti progetti qui sarebbe solo
      // rumore, 11/08/2026).
      const perimeter = await visibleTaskWhere(user, { projectTasks: "involved" });
      base = perimeter
        ? { AND: [perimeter], kind: { in: listKinds }, parentTaskId: null }
        : { id: { in: [] } }; // non vede niente: elenco vuoto, non un errore
    } else {
      base = { kind: TaskKind.ADMIN, parentTaskId: null };
    }
    // Nel riepilogo il perimetro copre già i permessi: riapplicarli
    // nasconderebbe i task di progetto dei colleghi a chi li può vedere.
    const scopeGuards = wide ? [] : permissionFilters;
    /** Il where della lista, e quello di ogni tendina senza il proprio filtro. */
    const whereFor = (except?: FacetKey): Prisma.TaskWhereInput => {
      const clauses = taskFiltersWhere(filters, base, listKinds, except);
      if (scopeGuards.length === 0) return clauses;
      // I permessi valgono sempre, anche nelle facet: una tendina non deve
      // offrire una voce fatta di task che l'utente non vedrebbe.
      const { AND, ...rest } = clauses;
      const existing = Array.isArray(AND) ? AND : AND ? [AND] : [];
      return { ...rest, AND: [...existing, ...scopeGuards] };
    };
    const where = whereFor();

    const dir = filters.sortDir ?? "asc";
    const orderBy =
      filters.sortBy === "title"
        ? [{ title: dir }]
        : filters.sortBy === "status"
          ? [{ status: { order: dir } }]
          : filters.sortBy === "assignee"
            ? [{ assignee: { name: dir } }]
            : filters.sortBy === "createdAt"
              ? [{ createdAt: dir }]
              : [
                  { dueDate: { sort: dir, nulls: "last" as const } },
                  { createdAt: "desc" as const },
                ];

    const [
      tasks,
      total,
      byStatus,
      byAssignee,
      byType,
      byArea,
      perCliente,
      statuses,
      users,
      types,
      companies,
    ] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskListInclude,
        orderBy,
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.task.count({ where }),
      prisma.task.groupBy({
        by: ["statusId"],
        where: whereFor("status"),
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["assigneeId"],
        where: whereFor("assignee"),
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["activityTypeId"],
        where: whereFor("type"),
        _count: { _all: true },
      }),
      // Per area serve anche il kind: senza tipo (o con un tipo Generale) è il
      // MODULO a decidere, e nel riepilogo i moduli sono due.
      prisma.task.groupBy({
        by: ["activityTypeId", "kind"],
        where: whereFor("area"),
        _count: { _all: true },
      }),
      /**
       * Il cliente non è una colonna: viene da cinque relazioni diverse, e
       * `groupBy` non sa raggrupparci sopra. Si leggono i soli id — cinque
       * campi corti sull\'insieme filtrato, qualche centinaio di righe nello
       * scadenzario aperto — e si conta qui.
       */
      prisma.task.findMany({ where: whereFor("company"), select: companyIdSelect }),
      prisma.taskStatus.findMany({ select: { id: true, name: true, order: true } }),
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.activityType.findMany({ select: { id: true, name: true, category: true } }),
      prisma.company.findMany({ select: { id: true, name: true } }),
    ]);

    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const companyCounts = new Map<string, number>();
    for (const row of perCliente) {
      const id = companyIdOf(row);
      if (id) companyCounts.set(id, (companyCounts.get(id) ?? 0) + 1);
    }

    // Aree di lavoro DAVVERO presenti, col loro numero: la tendina non deve
    // offrire un'area vuota — nello scadenzario, per dire, i task tecnici non
    // esistono (stanno nei progetti) e sceglierla dava una lista vuota senza
    // spiegazione (11/08/2026). La regola di appartenenza è quella condivisa
    // (`statusCategoryOf`): vince il tipo di mestiere, Generali e senza-tipo
    // ricadono nel modulo.
    const areaCounts = new Map<ActivityCategory, number>();
    for (const row of byArea) {
      const type = row.activityTypeId ? typeById.get(row.activityTypeId) : null;
      const area = statusCategoryOf({ activityType: type ?? null, kind: row.kind });
      areaCounts.set(area, (areaCounts.get(area) ?? 0) + row._count._all);
    }
    /**
     * La voce SCELTA resta in elenco anche se in questo contesto vale zero: la
     * tendina deve poter mostrare ciò che si è scelto (e l'autoguarigione dei
     * filtri, lato web, cancellerebbe una selezione che non trova più).
     */
    const withSelected = <T extends { id: string }>(
      rows: T[],
      selected: string | undefined,
      make: (id: string) => T | null,
    ): T[] => {
      if (!selected || rows.some((row) => row.id === selected)) return rows;
      const extra = make(selected);
      return extra ? [...rows, extra] : rows;
    };

    const facets = {
      statuses: withSelected(
        byStatus
          .map((row) => ({
            id: row.statusId!,
            name: statusById.get(row.statusId!)?.name ?? "—",
            count: row._count._all,
            order: statusById.get(row.statusId!)?.order ?? 0,
          }))
          .sort((a, b) => a.order - b.order)
          .map(({ id, name, count }) => ({ id, name, count }))
          .filter((row) => row.count > 0 || row.id === filters.statusId),
        filters.statusId,
        (id) => (statusById.has(id) ? { id, name: statusById.get(id)!.name, count: 0 } : null),
      ),
      assignees: withSelected(
        byAssignee
          .filter((row) => row.assigneeId !== null)
          .map((row) => ({
            id: row.assigneeId!,
            name: userName.get(row.assigneeId!) ?? "—",
            count: row._count._all,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "it")),
        filters.assigneeId,
        (id) => (userName.has(id) ? { id, name: userName.get(id)!, count: 0 } : null),
      ),
      activityTypes: withSelected(
        byType
          .filter((row) => row.activityTypeId !== null)
          .map((row) => ({
            id: row.activityTypeId!,
            name: typeName.get(row.activityTypeId!) ?? "—",
            count: row._count._all,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "it")),
        filters.activityTypeId,
        (id) => (typeName.has(id) ? { id, name: typeName.get(id)!, count: 0 } : null),
      ),
      companies: withSelected(
        [...companyCounts]
          .map(([id, count]) => ({ id, name: companyName.get(id) ?? "—", count }))
          .sort((a, b) => a.name.localeCompare(b.name, "it")),
        filters.companyId,
        (id) => (companyName.has(id) ? { id, name: companyName.get(id)!, count: 0 } : null),
      ),
      areas: ACTIVITY_CATEGORY_ORDER.filter((category) => (areaCounts.get(category) ?? 0) > 0).map(
        (category) => ({ category, count: areaCounts.get(category)! }),
      ),
    };

    const accessCtx = await taskAccessContext(user);
    return {
      items: tasks.map((t) => toTaskListItem(t, accessCtx)),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      facets,
    };
  });

  /**
   * Export CSV (solo admin): uno SCARICO GREZZO, per scelta esplicita
   * (06/08/2026) — non la fotografia della tabella a video. Rispetta solo i
   * filtri di base (ricerca nel titolo, stato, assegnatario, chiusi, progetto)
   * e include anche i subtask. Se un giorno dovrà coincidere con la tabella,
   * il punto di aggancio è `taskFiltersWhere`.
   */
  app.get("/api/tasks/export", async (request, reply) => {
    const user = requireAdmin(request);
    const filters = taskFiltersSchema.parse(request.query);
    if (filters.projectId) {
      await assertProjectView(user, filters.projectId);
    } else if (!(await canSeeScope(user, VisibilityScope.ADMIN_TASKS))) {
      throw forbidden("Non hai accesso ai task amministrativi");
    }
    const tasks = await prisma.task.findMany({
      where: {
        boardId: null, // esclude i task di board (statusId null)
        ...(filters.projectId
          ? { kind: TaskKind.PROJECT, projectId: filters.projectId }
          : { kind: TaskKind.ADMIN }),
        ...(filters.statusId ? { statusId: filters.statusId } : {}),
        ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
        ...(filters.q ? { title: { contains: filters.q } } : {}),
        ...closedTaskWhere(filters),
      },
      include: taskListInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
    const escape = csvCell;
    const lines = [
      "Titolo;Stato;Assegnatario;Supervisore;Scadenza;Creato;Chiuso",
      ...tasks.map((task) =>
        [
          escape(task.title),
          escape(task.status!.name),
          escape(task.assignee?.name ?? ""),
          escape(task.supervisor?.name ?? ""),
          task.dueDate?.toISOString().slice(0, 10) ?? "",
          task.createdAt.toISOString().slice(0, 10),
          task.closedAt?.toISOString().slice(0, 10) ?? "",
        ].join(";"),
      ),
    ];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="task.csv"');
    return lines.join("\r\n");
  });

  app.get("/api/tasks/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const task = await loadTaskDetail(id);
    // I task di board hanno un percorso dedicato (/api/boards/:id/tasks): qui 404,
    // altrimenti il serializer (che assume lo stato globale) crasherebbe.
    if (task.boardId) throw notFound("Task non trovato");
    await assertTaskViewAccess(user, task);
    for (const aggancio of agganciTask()) await aggancio.dettaglioAperto?.(task, user);
    return dettaglioPerChiGuarda(user, toTaskDetail(task, await taskAccessContext(user)));
  });

  app.post("/api/tasks", async (request, reply) => {
    const user = requireUser(request);
    const input = createTaskSchema.parse(request.body);
    const task = await createTaskAs(user, input);

    return reply
      .status(201)
      .send(toTaskDetail(await loadTaskDetail(task.id), await taskAccessContext(user)));
  });

  app.patch("/api/tasks/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const input = updateTaskSchema.parse(request.body);
    // Tutta la logica (stato, sequenze, ricorrenze, changelog, notifiche) vive nel
    // service: qui restano solo autenticazione e parsing.
    return applyTaskUpdate(user, id, input);
  });

  app.delete("/api/tasks/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) throw notFound("Task non trovato");
    await assertTaskEditAccess(user, existing);
    for (const aggancio of agganciTask()) await aggancio.primaDiEliminare?.(existing, user);

    // Eliminazione riservata a chi ha creato il task (o a un amministratore).
    if (user.role !== UserRole.ADMIN && existing.creatorId !== user.id) {
      throw forbidden("Solo l'amministratore o chi ha creato il task può eliminarlo");
    }

    // Soft delete: il task (e i suoi subtask) vengono spostati nel cestino. Il
    // record resta, quindi la riga di log sopravvive e racconta chi l'ha eliminato.
    await prisma.$transaction(async (tx) => {
      await logActivity(tx, id, user.id, "deleted");
    });
    await softDeleteTask(id);
    return reply.status(204).send();
  });

  // Commenti in modo lazy: pagina più recente prima, si scorre a ritroso col cursore.
  app.get("/api/tasks/:id/comments", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const { cursor, limit } = parseTimelineQuery(request.query);

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task non trovato");
    await assertTaskViewAccess(user, task);

    const rows = await prisma.comment.findMany({
      // Chi sta fuori non vede i riservati agli interni né i cifrati altrui.
      where: { AND: [{ taskId: id }, messaggiVisibiliA(user)] },
      include: commentInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1, // una in più per sapere se c'è altro
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toCommentDto),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  // Storico attività in modo lazy (timeline): stessa paginazione a cursore.
  app.get("/api/tasks/:id/activities", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const { cursor, limit } = parseTimelineQuery(request.query);

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task non trovato");
    await assertTaskViewAccess(user, task);

    const rows = await prisma.activityLog.findMany({
      where: { taskId: id },
      include: activityInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toActivityDto),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  /**
   * **Duplica un task.**
   *
   * Si copia la *definizione* — cosa c'è da fare, chi se ne occupa, quando, in
   * che progetto, con quali allegati — e non la *storia*: commenti, registro
   * attività e ore restano dell'originale. Un duplicato serve a rifare un
   * lavoro simile, non a raccontare che è già stato fatto.
   *
   * Restano fuori anche i legami che valgono per uno solo: l'offerta che ha
   * generato il task (`sourceDealId` è unico), la ricorrenza che lo ha
   * materializzato, il posto nella catena dei propedeutici e il riferimento
   * esterno di una richiesta — due task che dichiarano lo stesso numero di
   * osTicket sono una bugia in due copie.
   *
   * Gli allegati si **condividono** dalla tabella ponte, come nel task da
   * offerta vinta: i file non si duplicano.
   */
  app.post("/api/tasks/:id/duplicate", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const original = await prisma.task.findUnique({
      where: { id },
      include: { tags: true, attachments: true },
    });
    if (!original) throw notFound("Task non trovato");
    await assertTaskEditAccess(user, original);
    // Un'offerta non è un task come gli altri: ha una pipeline, un valore e una
    // probabilità, e duplicarla dallo scadenzario sarebbe un'altra funzione.
    if (original.kind === TaskKind.DEAL) throw badRequest("Un'offerta non si duplica da qui");

    /**
     * I titoli con cui non fare confusione: quelli **dello stesso contenitore**
     * — lo stesso progetto, o lo scadenzario. Cercare in tutto l'archivio
     * farebbe saltare il numero per una copia che vive da un'altra parte.
     */
    const vicini = await prisma.task.findMany({
      where: {
        kind: original.kind,
        projectId: original.projectId,
        boardId: original.boardId,
        title: { startsWith: stripCopySuffix(original.title) },
      },
      select: { title: true },
    });
    const title = nextCopyTitle(
      original.title,
      vicini.map((t) => t.title),
      localeFromRequest(request),
    );

    const copia = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          kind: original.kind,
          title,
          description: original.description,
          statusId: original.statusId,
          boardId: original.boardId,
          boardStatusId: original.boardStatusId,
          activityTypeId: original.activityTypeId,
          // Il creatore è chi duplica: è lui che ha aggiunto questa riga.
          creatorId: user.id,
          assigneeId: original.assigneeId,
          supervisorId: original.supervisorId,
          dueDate: original.dueDate,
          dueTime: original.dueTime,
          projectId: original.projectId,
          parentTaskId: original.parentTaskId,
          relatedDealId: original.relatedDealId,
          relatedProjectId: original.relatedProjectId,
          companyId: original.companyId,
          contactId: original.contactId,
          meetingId: original.meetingId,
          participants: original.participants,
          ...Object.assign({}, ...agganciTask().map((aggancio) => aggancio.duplica?.(original))),
          ...(original.tags.length > 0
            ? { tags: { create: original.tags.map((t) => ({ tagId: t.tagId })) } }
            : {}),
          ...(original.attachments.length > 0
            ? {
                attachments: {
                  create: original.attachments.map((a) => ({ attachmentId: a.attachmentId })),
                },
              }
            : {}),
        },
      });
      await logActivity(tx, created.id, user.id, "created", { duplicateOf: original.id });
      return created;
    });

    reply.code(201);
    return { id: copia.id, title: copia.title };
  });

  // Ogni messaggio è notifiche, push ed email a più persone: un tetto largo per persona.
  app.post(
    "/api/tasks/:id/comments",
    { config: { rateLimit: perUtente(60, "1 minute") } },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = request.params as { id: string };
      const input = createCommentSchema.parse(request.body);

      const task = await prisma.task.findUnique({ where: { id } });
      if (!task) throw notFound("Task non trovato");
      await assertTaskViewAccess(user, task);
      // I moduli dell'edizione dicono la loro (la presa in carico dei ticket, il
      // cliente da avvisare): una volta, prima di scrivere.
      const agganci: AggancioCommento[] = [];
      for (const aggancio of agganciTask()) {
        const esito = await aggancio.commento?.({ task, user, forza: Boolean(input.forza) });
        if (esito) agganci.push(esito);
      }

      /**
       * Indirizzato a @secret: il corpo si cifra PRIMA di toccare il database —
       * backup, copie e plugin vedono solo la busta. Le menzioni si leggono dal
       * testo originale, ma le notifiche non portano mai il contenuto.
       */

      // `@secret` e `@reserved` sono comandi degli interni: da fuori sono parole.
      const secret = puoCifrare(user) && hasSecretToken(input.body);
      /**
       * `@reserved` lo scrivono solo gli interni: dal portale resta una parola
       * del messaggio, perché un cliente che si nasconde il proprio messaggio
       * non ha niente da nascondere a nessuno (16/09/2026).
       */
      const reserved = !staFuori(user) && hasReservedToken(input.body);
      // `@user` e `@reserved` sono comandi, non parole del messaggio: si tolgono
      // sempre dal testo salvato, cifrato o no.
      let ripulito = input.body;
      if (hasUserToken(ripulito)) ripulito = stripUserToken(ripulito);
      if (reserved) ripulito = stripReservedToken(ripulito);
      /**
       * **Al cliente si scrive solo ciò che il cliente può leggere.** Un
       * messaggio riservato agli interni o cifrato, dal 16/09/2026, al portale
       * non esiste: mandarglielo per email vorrebbe dire avvisarlo di un
       * messaggio che poi, aperta la richiesta, non trova. `@user` insieme a
       * uno dei due non fa niente — e la marcatura «inviato al cliente» non
       * compare, così chi scrive lo vede.
       */
      const perIlCliente = hasUserToken(input.body) && !nascostoAChiStaFuori({ secret, reserved });
      const storedBody = secret ? encryptSecretBody(stripSecretToken(ripulito)) : ripulito;
      /**
       * **Si allega solo ciò che è già di questo task.**
       *
       * I file li ha caricati il browser prima di mandare il messaggio, sul task,
       * con i permessi e i formati che quell'endpoint sa applicare. Qui arrivano
       * solo gli identificativi — e un identificativo si può scrivere a mano:
       * senza questo controllo, citando l'id di un allegato di un altro task lo si
       * mostrerebbe dentro un messaggio a chi quel task non lo può nemmeno aprire.
       */
      const daAllegare =
        input.attachmentIds && input.attachmentIds.length > 0
          ? (
              await prisma.taskAttachment.findMany({
                where: { taskId: id, attachmentId: { in: input.attachmentIds } },
                select: { attachmentId: true },
              })
            ).map((legame) => legame.attachmentId)
          : [];

      const comment = await prisma.$transaction(async (tx) => {
        const created = await tx.comment.create({
          data: {
            taskId: id,
            authorId: user.id,
            body: storedBody,
            secret,
            reserved,
            ...Object.assign({}, ...agganci.map((aggancio) => aggancio.campi?.({ perIlCliente }))),
            meetingId: await ensureMeeting(input.meetingId),
            ...(daAllegare.length > 0
              ? { attachments: { create: daAllegare.map((attachmentId) => ({ attachmentId })) } }
              : {}),
          },
          include: commentInclude,
        });
        await logActivity(tx, id, user.id, "commented");
        return created;
      });

      /**
       * Notifiche: assegnatario/supervisore + @menzioni (senza doppioni).
       *
       * Chi sta fuori non si avvisa di un messaggio che non vede: menzionare il
       * cliente in un messaggio riservato o cifrato lo porterebbe a una chat in
       * cui quel messaggio non c'è. Il filtro guarda il ruolo di ognuno, perché
       * l'assegnatario di una richiesta può essere chiunque.
       *
       * **Né di un task che non vede** (18/09/2026): per un interno la menzione
       * apre il task in lettura, per chi sta fuori no — e la notifica gli
       * portava comunque titolo e autore di un task di progetto altrui. Un
       * cliente si avvisa solo se il task lo legge davvero: la sua richiesta.
       */
      const soloVisibili = async (ids: Array<string | null | undefined>): Promise<string[]> => {
        const candidati = ids.filter((uid): uid is string => Boolean(uid));
        if (candidati.length === 0) return candidati;
        const esterni = (await prisma.user.findMany({ where: { id: { in: candidati } } })).filter(
          (persona) => staFuori(persona),
        );
        const fuori = new Set<string>();
        for (const persona of esterni) {
          if (
            nascostoAChiStaFuori({ secret, reserved }) ||
            !evaluateTaskAccess(await taskAccessContext(persona), task).canView
          ) {
            fuori.add(persona.id);
          }
        }
        return candidati.filter((uid) => !fuori.has(uid));
      };
      const mentioned = await soloVisibili(await findMentionedUserIds(input.body));
      await notifyMany(mentioned, user.id, NotificationType.MENTION, {
        message: (t) =>
          t('{{actor}} ti ha menzionato in "{{title}}"', { actor: user.name, title: task.title }),
        taskId: id,
        taskKind: task.kind as TaskKind,
      });
      const alreadyMentioned = new Set(mentioned);
      await notifyMany(
        await soloVisibili(
          [task.assigneeId, task.supervisorId, ...agganci.flatMap((a) => a.seguaci ?? [])].filter(
            (uid) => !uid || !alreadyMentioned.has(uid),
          ),
        ),
        user.id,
        NotificationType.TASK_COMMENT,
        {
          message: (t) =>
            t('{{actor}} ha commentato "{{title}}"', { actor: user.name, title: task.title }),
          taskId: id,
          taskKind: task.kind as TaskKind,
        },
      );
      for (const aggancio of agganci) {
        await aggancio.dopo?.({ perIlCliente, menzionati: mentioned, testo: ripulito });
      }

      return reply.status(201).send(toCommentDto(comment));
    },
  );

  /**
   * Sblocco di un messaggio riservato: chi può VEDERE il task deve anche
   * RIAUTENTICARSI — la propria password, o un codice usa-e-getta via email
   * (per chi entra con Google e una password non ce l'ha: la casella è la sua
   * identità). Ogni sblocco riuscito resta nello storico del task.
   */
  app.post("/api/tasks/:id/comments/:commentId/unlock", async (request) => {
    const user = requireUser(request);
    const { id, commentId } = request.params as { id: string; commentId: string };
    const input = unlockSecretCommentSchema.parse(request.body);

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw notFound("Task non trovato");
    await assertTaskViewAccess(user, task);
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    // A chi non lo vede non esiste: 404, come ogni cosa fuori perimetro.
    if (
      !comment ||
      comment.taskId !== id ||
      !comment.secret ||
      !messaggioVisibileA(user, comment)
    ) {
      throw notFound("Messaggio riservato non trovato");
    }

    if (input.method === "otp-request") {
      if (!(await inCooldown(user.id, ChallengeType.UNLOCK_OTP))) {
        const code = await createOtpChallenge(user, ChallengeType.UNLOCK_OTP);
        await sendUnlockCodeEmail(
          { email: user.email, name: user.nickName || user.name, locale: user.locale },
          code,
        );
      }
      return { sent: true };
    }

    const verified =
      input.method === "password"
        ? user.passwordHash !== null && (await verifyPassword(user.passwordHash, input.password))
        : await verifyOtpChallenge(user, input.code, ChallengeType.UNLOCK_OTP);
    if (!verified) {
      request.log.warn({ userId: user.id, commentId }, "Sblocco messaggio riservato rifiutato");
      throw forbidden("Verifica non riuscita");
    }

    // Lo sblocco lascia traccia: chi ha letto cosa è parte della storia del task.
    await prisma.$transaction(async (tx) => {
      await logActivity(tx, id, user.id, "secret_unlocked");
    });
    return { body: decryptSecretBody(comment.body) };
  });

  app.delete("/api/tasks/:id/comments/:commentId", async (request, reply) => {
    const user = requireUser(request);
    const { id, commentId } = request.params as { id: string; commentId: string };
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== id) throw notFound("Commento non trovato");
    if (user.role !== UserRole.ADMIN && comment.authorId !== user.id) {
      throw forbidden("Puoi eliminare solo i tuoi commenti");
    }
    /**
     * **Il messaggio si porta via i file arrivati con lui.**
     *
     * Sono la stessa cosa per chi legge: «ciapa l'allegato!» e il documento
     * sotto. Lasciare il file negli allegati dopo aver cancellato la frase che
     * lo spiegava vorrebbe dire tenere un documento che nessuno sa più cosa
     * sia, e togliere alla persona che l'ha mandato l'unico modo di ritirarlo
     * (dagli allegati il comando è vietato, apposta — 04/09/2026).
     *
     * Si **scollega** dal task, come fa il comando degli allegati: il file su
     * disco lo rimuove lo sweep, quando non è più agganciato a niente.
     */
    const attachmentIds = (
      await prisma.commentAttachment.findMany({
        where: { commentId },
        select: { attachmentId: true },
      })
    ).map((legame) => legame.attachmentId);

    await prisma.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id: commentId } });
      if (attachmentIds.length > 0) {
        await tx.taskAttachment.deleteMany({
          where: { taskId: id, attachmentId: { in: attachmentIds } },
        });
      }
    });
    return reply.status(204).send();
  });
}
