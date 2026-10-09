import type { FastifyInstance } from "fastify";
import { TaskKind, UserRole, VisibilityScope, type SearchResult } from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { requireUser } from "../../plugins/auth";
import { canSeeScope } from "../visibility/service";
import { visibleTaskWhere } from "../visibility/task-perimeter";
import { visibleProjectsWhere } from "../projects/access";
import { companyNameWhere } from "../tasks/company";
import { messaggiVisibiliA } from "../tasks/comment-visibility";

/**
 * Ricerca globale (Ctrl+K): "cerca ovunque" deve cercare ovunque DAVVERO —
 * task, offerte, ticket, progetti, ricorrenze, messaggi delle chat, nomi degli
 * allegati e titoli dei link, contatti e aziende.
 *
 * La regola più importante sta in `visibleTaskWhere` (modulo condiviso con la
 * tendina del timesheet): OGNI query che tocca
 * un task o qualcosa che gli appartiene (messaggio, allegato) passa da quel
 * perimetro, costruito una volta per richiesta. Cercare non deve mai mostrare
 * ciò che le pagine non mostrerebbero: un titolo, una riga di chat o il nome di
 * un file sono già informazione ("Offerta Rossi 250k", "licenziamento.pdf").
 *
 * Il perimetro d'ingresso è già stretto dal plugin auth: PORTAL e SALES_MONITOR
 * non raggiungono `/api/search` (le loro aree hanno le proprie viste). Qui
 * dentro si distingue solo tra interni con e senza i vari permessi.
 */

/** Riassunto breve di un testo lungo attorno al punto in cui compare la parola. */
function snippet(text: string, q: string, radius = 40): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return clean.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(clean.length, at + q.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

const taskSubtitle = (task: {
  kind: string;
  project?: { name: string } | null;
  dealStage?: { name: string } | null;
  status?: { name: string } | null;
  createdViaTicket?: boolean;
}): string =>
  task.kind === TaskKind.PROJECT
    ? `${task.createdViaTicket ? "Ticket · " : ""}Progetto: ${task.project?.name ?? "—"}`
    : task.kind === TaskKind.DEAL
      ? `Offerta · ${task.dealStage?.name ?? "—"}`
      : task.kind === TaskKind.TICKET
        ? "Ticket"
        : `Scadenzario · ${task.status?.name ?? "—"}`;

export function searchRoutes(app: FastifyInstance): void {
  app.get("/api/search", async (request) => {
    const user = requireUser(request);
    const { q } = z.object({ q: z.string().min(2).max(100) }).parse(request.query);

    const [taskWhere, seesContacts, seesDeals, seesAdmin] = await Promise.all([
      visibleTaskWhere(user),
      canSeeScope(user, VisibilityScope.CONTACTS),
      canSeeScope(user, VisibilityScope.DEALS),
      canSeeScope(user, VisibilityScope.ADMIN_TASKS),
    ]);

    const results: SearchResult[] = [];
    // Un task trovato per titolo non deve ricomparire per un suo messaggio o
    // allegato: la prima voce basta ad arrivarci.
    const seenTaskIds = new Set<string>();

    // --- Task (titolo, descrizione e **cliente**), offerte e ticket compresi.
    //     Il cliente si cerca perché è così che si chiede una cosa a voce —
    //     "quel lavoro per Atlante" — e il nome dell'azienda spesso nel titolo
    //     non c'è. Non è un campo del task: arriva dalle sue relazioni, con la
    //     precedenza di `modules/tasks/company.ts` (19/08/2026).
    if (taskWhere) {
      const tasks = await prisma.task.findMany({
        where: {
          ...taskWhere,
          AND: [
            {
              OR: [
                { title: { contains: q } },
                { description: { contains: q } },
                companyNameWhere(q),
              ],
            },
          ],
        },
        include: { project: true, status: true, dealStage: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      });
      for (const task of tasks) {
        seenTaskIds.add(task.id);
        results.push({
          type:
            task.kind === TaskKind.DEAL
              ? "deal"
              : task.kind === TaskKind.TICKET
                ? "ticket"
                : "task",
          id: task.id,
          title: task.title,
          subtitle: taskSubtitle(task),
          projectId: task.projectId,
          closed: task.status?.isClosed ?? false,
          statusName: task.status?.name ?? null,
        });
      }

      // --- Messaggi delle chat: si apre il task che li contiene.
      const comments = await prisma.comment.findMany({
        // i riservati restano fuori: il cifrato non matcherebbe, ma il no è di regola
        where: {
          AND: [{ body: { contains: q }, secret: false, task: taskWhere }, messaggiVisibiliA(user)],
        },
        include: { task: { select: { id: true, title: true, kind: true } } },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      for (const comment of comments) {
        if (seenTaskIds.has(comment.task.id)) continue;
        seenTaskIds.add(comment.task.id);
        results.push({
          type: "comment",
          id: comment.id,
          title: comment.task.title,
          subtitle: `Messaggio: “${snippet(comment.body, q)}”`,
          taskId: comment.task.id,
          taskKind: comment.task.kind,
        });
        if (results.length >= 25) break;
      }

      // --- Allegati e link, per nome/titolo: anche qui si apre il task. Il
      // legame è molti-a-molti (i file delle offerte vinte sono condivisi con il
      // task di fatturazione): un file è visibile se ALMENO UNO dei suoi task lo
      // è, ed è quel task che si apre.
      const attachments = await prisma.attachment.findMany({
        where: { name: { contains: q }, tasks: { some: { task: taskWhere } } },
        include: {
          tasks: {
            where: { task: taskWhere },
            include: { task: { select: { id: true, title: true, kind: true } } },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      for (const attachment of attachments) {
        const task = attachment.tasks[0]?.task;
        if (!task) continue;
        results.push({
          type: "attachment",
          id: attachment.id,
          title: attachment.name,
          subtitle: `${attachment.type === "LINK" ? "Link" : "Allegato"} in: ${task.title}`,
          taskId: task.id,
          taskKind: task.kind,
        });
      }
    }

    // --- Progetti per nome/descrizione: **stessa** regola dell'elenco progetti
    //     e della scheda cliente, ora davvero (visibleProjectsWhere). Ricerca e
    //     visibilità sotto AND: entrambe hanno una chiave OR e si calpesterebbero.
    const projects = await prisma.project.findMany({
      where: {
        AND: [
          await visibleProjectsWhere(user),
          {
            OR: [
              { name: { contains: q } },
              { description: { contains: q } },
              // Anche per cliente: "i progetti di Atlante" è una domanda comune.
              { company: { name: { contains: q } } },
            ],
          },
        ],
      },
      take: 5,
    });
    for (const project of projects) {
      results.push({
        type: "project",
        id: project.id,
        title: project.name,
        subtitle: project.isArchived ? "Progetto · archiviato" : "Progetto",
      });
    }

    // --- Ricorrenze: come il loro elenco (scope Scadenzario, o le proprie).
    const templates = await prisma.recurrenceTemplate.findMany({
      where: {
        title: { contains: q },
        ...(seesAdmin
          ? {}
          : {
              OR: [{ creatorId: user.id }, { assigneeId: user.id }, { supervisorId: user.id }],
            }),
      },
      take: 4,
    });
    for (const template of templates) {
      results.push({
        type: "recurrence",
        id: template.id,
        title: template.title,
        subtitle: template.isActive ? "Ricorrenza" : "Ricorrenza · sospesa",
      });
    }

    // --- Contatti (nome, email): solo con lo scope.
    if (seesContacts) {
      const contacts = await prisma.contact.findMany({
        where: {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { email: { contains: q } },
          ],
        },
        include: { company: true },
        take: 4,
      });
      for (const contact of contacts) {
        results.push({
          type: "contact",
          id: contact.id,
          title: `${contact.firstName} ${contact.lastName}`,
          subtitle: contact.company?.name ?? contact.email ?? "Contatto",
        });
      }
    }

    // --- Aziende: tutte per chi lavora il CRM, solo quelle dei propri progetti
    //     per gli altri.
    const companies = await prisma.company.findMany({
      where: {
        name: { contains: q },
        ...(user.role === UserRole.ADMIN || seesDeals || seesContacts
          ? {}
          : { projects: { some: { deletedAt: null, members: { some: { userId: user.id } } } } }),
      },
      take: 4,
    });
    for (const company of companies) {
      results.push({
        type: "company",
        id: company.id,
        title: company.name,
        subtitle: [company.city, company.vatNumber].filter(Boolean).join(" · ") || "Azienda",
      });
    }

    return results.slice(0, 25);
  });
}
