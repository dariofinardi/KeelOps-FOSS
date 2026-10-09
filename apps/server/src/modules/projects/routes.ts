import type { FastifyInstance } from "fastify";
import {
  NotificationType,
  PROJECT_ROLE_LABELS,
  ProjectRole,
  TaskKind,
  createProjectSchema,
  updateColumnOrderSchema,
  updateProjectMembersSchema,
  updateProjectOrderSchema,
  updateProjectSchema,
  type ColumnOrderMap,
  type ProjectListItem,
} from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { giorniFa } from "../../lib/dialetto";
import { notify } from "../notifications/service";
import { notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { Prisma } from "../../generated/prisma/client";
import type { User } from "../../generated/prisma/client";
import { softDeleteProject } from "../trash/service";
import { assertCanSeeDeals } from "../visibility/service";
import {
  assertProjectManage,
  assertProjectView,
  projectRoleOf,
  visibleProjectsWhere,
} from "./access";

const projectInclude = {
  members: { include: { user: true } },
  company: { select: { id: true, name: true } },
  // Offerta di provenienza. Il collegamento vive sull'offerta
  // (`Task.relatedProjectId`) e si legge da qui: una verità sola, in un posto
  // solo. Più offerte possono puntare allo stesso progetto (una commessa con
  // seguiti): il progetto mostra la prima, quella da cui è nato.
  relatedTickets: {
    where: { kind: TaskKind.DEAL, deletedAt: null },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" as const },
    take: 1,
  },
  // Solo i task non eliminati contano per l'avanzamento e per la mia scadenza.
  tasks: {
    where: { deletedAt: null },
    select: {
      id: true,
      dueDate: true,
      assigneeId: true,
      supervisorId: true,
      createdAt: true,
      status: { select: { isClosed: true } },
    },
  },
} satisfies Prisma.ProjectInclude;

type ProjectWithRelations = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/**
 * Quando l'utente ha lavorato l'ultima volta su ciascun progetto: una modifica
 * registrata, un commento scritto o delle ore imputate su un suo task.
 *
 * Serve all'ordine consigliato — un progetto su cui si sta lavorando deve salire
 * mentre ci si lavora, e l'assegnazione da sola non lo dice (spesso i task sono
 * di altri, o senza scadenza). Una query sola, in SQL: le tre tabelle puntano al
 * task, non al progetto, e raggrupparle in Prisma vorrebbe dire caricarle tutte.
 * Oltre i 90 giorni non cambia più niente nell'ordine: si tagliano lì.
 */
async function myLastActivityByProject(userId: string): Promise<Map<string, string>> {
  // Gli identificatori senza virgolette: SQLite e MySQL li accettano entrambi
  // così, e nessuno di questi nomi è una parola riservata. Cambia solo il modo
  // di dire "novanta giorni fa", che sta nell'angolo del dialetto.
  const rows = await prisma.$queryRaw<Array<{ projectId: string; lastAt: string }>>`
    SELECT t.projectId AS projectId, MAX(x.quando) AS lastAt
    FROM (
      SELECT taskId, createdAt AS quando FROM ActivityLog WHERE userId = ${userId}
      UNION ALL
      SELECT taskId, createdAt AS quando FROM Comment WHERE authorId = ${userId}
      UNION ALL
      SELECT taskId, date AS quando FROM TimeEntry WHERE userId = ${userId}
    ) x
    JOIN Task t ON t.id = x.taskId
    WHERE t.projectId IS NOT NULL
      AND t.deletedAt IS NULL
      AND x.quando > ${Prisma.raw(giorniFa(90))}
    GROUP BY t.projectId
  `;
  return new Map(rows.map((row) => [row.projectId, new Date(row.lastAt).toISOString()]));
}

function toDto(
  project: ProjectWithRelations,
  user: User,
  myLastActivityAt: string | null = null,
): ProjectListItem {
  const membership = project.members.find((m) => m.userId === user.id);
  // "Miei" vuol dire che me ne occupo: sia da esecutore che da referente.
  const myTasks = project.tasks.filter(
    (t) => t.assigneeId === user.id || t.supervisorId === user.id,
  );
  const myOpenTasks = myTasks.filter((t) => !t.status!.isClosed);
  // Prima scadenza tra i miei task aperti del progetto (per ordinare la lista).
  const myDueDates = myOpenTasks.filter((t) => t.dueDate).map((t) => t.dueDate!.getTime());
  const myNextDueDate =
    myDueDates.length > 0 ? new Date(Math.min(...myDueDates)).toISOString().slice(0, 10) : null;
  // Assegnazione più recente (proxy: createdAt del task), per la 2ª fascia d'ordine.
  const myLastAssignedAt =
    myTasks.length > 0
      ? new Date(Math.max(...myTasks.map((t) => t.createdAt.getTime()))).toISOString()
      : null;
  // Task più recente del progetto, di chiunque: è l'ultimo segnale di vita di un
  // progetto in cui non ho scadenze né lavoro mio.
  const lastTaskCreatedAt =
    project.tasks.length > 0
      ? new Date(Math.max(...project.tasks.map((t) => t.createdAt.getTime()))).toISOString()
      : null;
  const deal = project.relatedTickets[0] ?? null;
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color as ProjectListItem["color"],
    icon: project.icon as ProjectListItem["icon"],
    isArchived: project.isArchived,
    members: project.members.map((member) => ({
      user: { id: member.user.id, name: member.user.name },
      role: member.role as ProjectRole,
    })),
    company: project.company,
    deal: deal ? { id: deal.id, title: deal.title } : null,
    taskCount: project.tasks.length,
    closedTaskCount: project.tasks.filter((t) => t.status!.isClosed).length,
    myRole: membership ? (membership.role as ProjectRole) : null,
    myNextDueDate,
    myOpenTaskCount: myOpenTasks.length,
    myLastAssignedAt,
    myLastActivityAt,
    lastTaskCreatedAt,
  };
}

/**
 * Collega (o stacca) l'offerta di provenienza di un progetto.
 *
 * Il collegamento vive sull'offerta (`Task.relatedProjectId`): qui si scrive
 * **quello**, invece di aggiungere un secondo campo sul progetto che poi
 * andrebbe tenuto allineato. Dal lato progetto il legame è uno solo, quindi
 * prima si staccano le altre offerte che puntavano qui: un progetto che dichiara
 * due provenienze non risponde alla domanda "da dove nasce".
 *
 * Serve poter vedere le offerte: chi non ha quel modulo non può legarle a niente.
 */
async function linkProjectToDeal(
  user: User,
  projectId: string,
  dealId: string | null,
): Promise<void> {
  await assertCanSeeDeals(user);
  if (dealId) {
    const deal = await prisma.task.findUnique({ where: { id: dealId } });
    if (!deal || deal.kind !== TaskKind.DEAL || deal.deletedAt) {
      throw notFound("Offerta non trovata");
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { kind: TaskKind.DEAL, relatedProjectId: projectId, id: { not: dealId ?? undefined } },
      data: { relatedProjectId: null },
    });
    if (dealId) {
      await tx.task.update({ where: { id: dealId }, data: { relatedProjectId: projectId } });
    }
  });
}

/** Normalizza il companyId in ingresso: null/vuoto → null, id inesistente → 404. */
async function validCompanyId(companyId: string | null | undefined): Promise<string | null> {
  if (!companyId) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw notFound("Azienda non trovata");
  return company.id;
}

export function projectRoutes(app: FastifyInstance): void {
  app.get("/api/projects", async (request) => {
    const user = requireUser(request);
    // Ricerca dall'elenco: per nome del progetto e, con `searchTasks`, anche nei
    // titoli dei suoi task — così si trova il progetto partendo da quello che ci
    // si ricorda ("dov'era quel task sul configuratore?").
    const { q, searchTasks } = z
      .object({
        q: z.string().trim().optional(),
        searchTasks: z
          .enum(["true", "false"])
          .optional()
          .transform((value) => value === "true"),
      })
      .parse(request.query);
    // Il cliente entra sempre nella ricerca, con o senza i task: "i progetti di
    // Boreal" è una domanda che si fa scrivendo il nome dell'azienda.
    const search: Prisma.ProjectWhereInput = q
      ? {
          OR: [
            { name: { contains: q } },
            { company: { name: { contains: q } } },
            ...(searchTasks
              ? [{ tasks: { some: { title: { contains: q }, deletedAt: null } } }]
              : []),
          ],
        }
      : {};
    // Si vedono i progetti di cui si è membri; lo scope di gruppo "Progetti" (anche
    // in sola lettura) li mostra tutti, come per gli altri moduli.
    // Chi vede quali progetti: regola unica (visibleProjectsWhere) — membro, o
    // con del lavoro assegnato/supervisionato. La stessa che usano la ricerca e
    // la scheda cliente, ma **qui con `onlyOpenWork`**: l'elenco è la scrivania,
    // e un progetto dove non si è membri e non resta niente da fare non ci va.
    // Resta raggiungibile dalla ricerca e dalla propria bacheca, che usano la
    // regola piena.
    const visibility = await visibleProjectsWhere(user, { onlyOpenWork: true });
    const [projects, lastActivity] = await Promise.all([
      prisma.project.findMany({
        // Ricerca e visibilità sotto AND: `search` e `visibility` possono avere
        // entrambi una chiave `OR`, e spreadate sullo stesso oggetto la seconda
        // cancellava la prima — per i non privilegiati la ricerca spariva.
        where: { AND: [search, visibility] },
        include: projectInclude,
        orderBy: { name: "asc" },
      }),
      myLastActivityByProject(user.id),
    ]);
    return projects.map((project) => toDto(project, user, lastActivity.get(project.id) ?? null));
  });

  app.get("/api/projects/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const { onlyOwnTasks } = await assertProjectView(user, id);
    const project = await prisma.project.findUnique({ where: { id }, include: projectInclude });
    if (!project) throw notFound("Progetto non trovato");
    // Il perimetro viaggia col progetto: la pagina deve poter dire "di questo
    // vedi solo il tuo" dove la differenza cambia il senso (la nota di
    // rilascio), e dal browser non si può dedurre.
    return { ...toDto(project, user), onlyOwnTasks };
  });

  app.post("/api/projects", async (request, reply) => {
    const user = requireUser(request);
    const input = createProjectSchema.parse(request.body);
    const project = await prisma.project.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        icon: input.icon ?? null,
        companyId: await validCompanyId(input.companyId),
        members: { create: { userId: user.id, role: ProjectRole.MANAGER } },
      },
      include: projectInclude,
    });
    if (input.dealId !== undefined) {
      await linkProjectToDeal(user, project.id, input.dealId ?? null);
    }
    const created = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: projectInclude,
    });
    return reply.status(201).send(toDto(created, user));
  });

  app.patch("/api/projects/:id", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await assertProjectManage(user, id);
    const input = updateProjectSchema.parse(request.body);
    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.color !== undefined ? { color: input.color ?? null } : {}),
        ...(input.icon !== undefined ? { icon: input.icon ?? null } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.companyId !== undefined
          ? { companyId: await validCompanyId(input.companyId) }
          : {}),
      },
      include: projectInclude,
    });
    if (input.dealId !== undefined) {
      await linkProjectToDeal(user, id, input.dealId ?? null);
      const updated = await prisma.project.findUniqueOrThrow({
        where: { id },
        include: projectInclude,
      });
      return toDto(updated, user);
    }
    return toDto(project, user);
  });

  app.delete("/api/projects/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await assertProjectManage(user, id);

    // Soft delete: progetto e relativi task nel cestino.
    await softDeleteProject(id);
    return reply.status(204).send();
  });

  app.put("/api/projects/:id/members", async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await assertProjectManage(user, id);
    const input = updateProjectMembersSchema.parse(request.body);
    const prima = await prisma.projectMember.findMany({
      where: { projectId: id },
      select: { userId: true },
    });

    const project = await prisma.$transaction(async (tx) => {
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      await tx.projectMember.createMany({
        data: input.members.map((member) => ({
          projectId: id,
          userId: member.userId,
          role: member.role,
        })),
      });
      return tx.project.findUniqueOrThrow({ where: { id }, include: projectInclude });
    });

    // Chi entra adesso lo viene a sapere, con il ruolo che gli è stato dato:
    // "Visualizzatore" e "Editor" non permettono le stesse cose, e chi riceve
    // l'avviso deve capire cosa può fare senza doverlo chiedere. Chi c'era già
    // non riceve niente: non è successo niente che lo riguardi.
    const nuovi = input.members.filter(
      (member) => !prima.some((existing) => existing.userId === member.userId),
    );
    await Promise.all(
      nuovi.map((member) =>
        notify(member.userId, user.id, NotificationType.PROJECT_MEMBER, {
          message: (t) =>
            t('{{actor}} ti ha aggiunto al progetto "{{project}}" come {{role}}', {
              actor: user.name,
              project: project.name,
              role: t(PROJECT_ROLE_LABELS[member.role]),
            }),
        }),
      ),
    );
    return toDto(project, user);
  });

  // Ordine manuale dei progetti nella vista dell'utente (preferenza personale).
  app.get("/api/profile/project-order", async (request) => {
    const user = requireUser(request);
    return { order: parseProjectOrder(user.projectOrder) };
  });

  app.put("/api/profile/project-order", async (request) => {
    const user = requireUser(request);
    const { order } = updateProjectOrderSchema.parse(request.body);
    await prisma.user.update({
      where: { id: user.id },
      // Array vuoto = torna all'ordine automatico (nessuna preferenza salvata).
      data: { projectOrder: order.length > 0 ? JSON.stringify(order) : null },
    });
    return { order };
  });

  // Ordine colonne kanban per-utente (per bacheca, identificata da una chiave).
  app.get("/api/profile/column-order", async (request) => {
    const user = requireUser(request);
    return { orders: parseColumnOrder(user.columnOrder) };
  });

  app.put("/api/profile/column-order", async (request) => {
    const user = requireUser(request);
    const { key, order } = updateColumnOrderSchema.parse(request.body);
    const orders = parseColumnOrder(user.columnOrder);
    if (order.length > 0) orders[key] = order;
    else delete orders[key]; // vuoto = ripristina l'ordine standard di quella bacheca
    const empty = Object.keys(orders).length === 0;
    await prisma.user.update({
      where: { id: user.id },
      data: { columnOrder: empty ? null : JSON.stringify(orders) },
    });
    return { orders };
  });
}

/** Legge la mappa chiave→ordine colonne (JSON); tollerante ai dati malformati. */
function parseColumnOrder(raw: string | null): ColumnOrderMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ColumnOrderMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

/** Legge l'ordine salvato (JSON array di id); tollerante ai dati malformati. */
function parseProjectOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export { projectRoleOf };
