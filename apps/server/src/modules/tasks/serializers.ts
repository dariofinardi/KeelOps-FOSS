// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TicketPriority, UserRole } from "@kancrm/shared";
import { toDateOnly } from "../../lib/date";
import type {
  Activity,
  ActivityTypeRef,
  Attachment as AttachmentDto,
  Comment as CommentDto,
  TaskDetail,
  TaskListItem,
} from "@kancrm/shared";
import type { Prisma } from "../../generated/prisma/client";
import { evaluateTaskAccess, type TaskAccessContext } from "./permissions";
import { companyOf } from "./company";

export const taskListInclude = {
  status: true,
  assignee: true,
  supervisor: true,
  activityType: true,
  // Contesto del task: progetto di appartenenza e azienda cliente. L'azienda può
  // arrivare da più parti — il task stesso, l'offerta collegata o generatrice, il
  // progetto (di appartenenza o di riferimento) se ha un'azienda associata: si
  // risolve qui una volta sola, non nella UI. Derivare invece di copiare vuol
  // dire che collegando il task a un'offerta o a un progetto l'azienda "si
  // compila da sola" e resta giusta anche se cambia sul progetto.
  company: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
  relatedDeal: { select: { id: true, title: true, company: { select: { id: true, name: true } } } },
  sourceDeal: { select: { company: { select: { id: true, name: true } } } },
  relatedProject: {
    select: { id: true, name: true, company: { select: { id: true, name: true } } },
  },
  meeting: { select: { id: true, title: true, dueDate: true } },
  tags: { include: { tag: true } },
  _count: { select: { attachments: true, comments: true } },
} satisfies Prisma.TaskInclude;

// Commenti e attività NON stanno più nel dettaglio: crescono senza tetto (un task
// ricorrente pluriennale ne accumula migliaia) e si caricano a parte, in modo lazy
// e paginato (vedi commentInclude/activityInclude e gli endpoint /comments|/activities).
export const taskDetailInclude = {
  ...taskListInclude,
  creator: true,
  attachments: {
    include: {
      attachment: {
        include: {
          uploadedBy: true,
          // Da quale messaggio è arrivato: uno solo, ed è quello che lo governa.
          comments: { select: { commentId: true }, take: 1 },
        },
      },
    },
  },
  predecessor: { include: { status: true } },
  successors: {
    where: { deletedAt: null },
    include: { status: true },
    // Il collegamento alla sequenza tocca updatedAt del successore: il
    // conseguente appena agganciato sta in cima, non dove lo mette la data di
    // creazione del task (che col collegamento non c'entra).
    orderBy: { updatedAt: "desc" },
  },
  parentTask: { include: { status: true } },
  subtasks: {
    where: { deletedAt: null },
    include: { status: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TaskInclude;

// Include riusabili per il caricamento lazy di commenti e attività (endpoint dedicati).
export const commentInclude = {
  author: true,
  meeting: { select: { id: true, title: true, dueDate: true } },
  // I file arrivati con il messaggio: si mostrano accanto alla frase che li
  // accompagnava. Restano allegati del task, questo dice solo con cosa sono
  // arrivati.
  attachments: { include: { attachment: { include: { uploadedBy: true } } } },
} satisfies Prisma.CommentInclude;
export const activityInclude = { user: true } satisfies Prisma.ActivityLogInclude;

type TaskForList = Prisma.TaskGetPayload<{ include: typeof taskListInclude }>;
type TaskForDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;
type CommentForDto = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;
type ActivityForDto = Prisma.ActivityLogGetPayload<{ include: typeof activityInclude }>;

const userRef = (user: { id: string; name: string }) => ({ id: user.id, name: user.name });

/**
 * I task normali hanno sempre uno stato globale (per categoria). I task di board
 * (PERSONAL/amministrativi su board) usano `boardStatus` e hanno un percorso di
 * serializzazione dedicato: qui non devono arrivare.
 */
function requireStatus<T>(task: { status: T | null }): T {
  if (!task.status) throw new Error("Task di board: usa il serializer dedicato delle board");
  return task.status;
}

/** DateTime → YYYY-MM-DD (le scadenze sono salvate a mezzanotte UTC). */


export function toTaskListItem(task: TaskForList, ctx: TaskAccessContext): TaskListItem {
  const status = requireStatus(task);
  const access = evaluateTaskAccess(ctx, task);
  return {
    id: task.id,
    kind: task.kind as TaskListItem["kind"],
    title: task.title,
    status: {
      id: status.id,
      name: status.name,
      category: status.category as TaskListItem["status"]["category"],
      color: status.color,
      order: status.order,
      isClosed: status.isClosed,
      isWonTarget: status.isWonTarget,
      isAssignedTarget: status.isAssignedTarget,
      stopsRecurrence: status.stopsRecurrence,
      isBillingMilestone: status.isBillingMilestone,
    wipLimit: status.wipLimit,
    },
    assignee: task.assignee ? userRef(task.assignee) : null,
    supervisor: task.supervisor ? userRef(task.supervisor) : null,
    dueDate: toDateOnly(task.dueDate),
    dueTime: task.dueTime,
    closedAt: task.closedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    attachmentCount: task._count.attachments,
    commentCount: task._count.comments,
    predecessorId: task.predecessorId,
    recurrenceTemplateId: task.recurrenceTemplateId,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    relatedDeal: task.relatedDeal
      ? { id: task.relatedDeal.id, title: task.relatedDeal.title }
      : null,
    project: task.project,
    // La precedenza sta in `company.ts`, insieme al `where` che filtra su di
    // essa: scritte in due punti, prima o poi il filtro nasconde righe che
    // l'elenco mostra.
    company: companyOf(task),
    relatedProject: task.relatedProject,
    createdViaTicket: task.createdViaTicket,
    // La priorità serve al colore del bordo negli elenchi: la portano solo le
    // richieste, e nasce media quando chi apre non la tocca.
    ticketPriority: task.createdViaTicket
      ? ((task.ticketPriority ?? TicketPriority.MEDIUM) as TicketPriority)
      : null,
    activityType: task.activityType
      ? ({
          id: task.activityType.id,
          name: task.activityType.name,
          color: task.activityType.color,
          category: task.activityType.category,
          isMeeting: task.activityType.isMeeting,
        } as ActivityTypeRef)
      : null,
    meeting: task.meeting
      ? {
          id: task.meeting.id,
          title: task.meeting.title,
          dueDate: toDateOnly(task.meeting.dueDate),
        }
      : null,
    participants: task.participants,
    tags: task.tags
      .map((tt) => ({ id: tt.tag.id, name: tt.tag.name, color: tt.tag.color }))
      .sort((a, b) => a.name.localeCompare(b.name, "it")),
    canEdit: access.canEdit,
    canDelete: access.canDelete,
  };
}

function toSequenceRef(task: { id: string; title: string; status: { isClosed: boolean } | null }) {
  return { id: task.id, title: task.title, isClosed: task.status?.isClosed ?? false };
}

export function toAttachmentDto(
  attachment: Omit<TaskForDetail["attachments"][number]["attachment"], "comments"> & {
    /**
     * Facoltativo: chi carica un file lo sa già (non viene da un messaggio), e
     * non deve chiedere al database una cosa che ha appena deciso.
     */
    comments?: Array<{ commentId: string }>;
  },
): AttachmentDto {
  return {
    id: attachment.id,
    type: attachment.type as AttachmentDto["type"],
    name: attachment.name,
    url: attachment.url,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt.toISOString(),
    uploadedBy: userRef(attachment.uploadedBy),
    commentId: attachment.comments?.[0]?.commentId ?? null,
  };
}

export function toCommentDto(comment: CommentForDto): CommentDto {
  return {
    id: comment.id,
    // riservato: il cifrato resta nel database, fuori esce il segnaposto vuoto
    body: comment.secret ? "" : comment.body,
    secret: comment.secret,
    reserved: comment.reserved,
    sentToClient: comment.sentToClient,
    createdAt: comment.createdAt.toISOString(),
    author: userRef(comment.author),
    meeting: comment.meeting
      ? {
          id: comment.meeting.id,
          title: comment.meeting.title,
          dueDate: toDateOnly(comment.meeting.dueDate),
        }
      : null,
    attachments: comment.attachments.map((legame) => toAttachmentDto(legame.attachment)),
  };
}

export function toActivityDto(activity: ActivityForDto): Activity {
  return {
    id: activity.id,
    action: activity.action,
    payload: activity.payload ? (JSON.parse(activity.payload) as unknown) : null,
    createdAt: activity.createdAt.toISOString(),
    user: userRef(activity.user),
  };
}

export function toTaskDetail(task: TaskForDetail, ctx: TaskAccessContext): TaskDetail {
  return {
    ...toTaskListItem(task, ctx),
    description: task.description,
    creator: userRef(task.creator),
    // Solo un cliente del portale è «fuori»: gli interni che aprono richieste
    // sono colleghi, e a loro `@user` non avrebbe niente da mandare.
    openedByClient: task.creator.role === UserRole.PORTAL,
    attachments: task.attachments.map((ta) => toAttachmentDto(ta.attachment)),
    // Un propedeutico nel cestino non viene mostrato.
    predecessor:
      task.predecessor && !task.predecessor.deletedAt ? toSequenceRef(task.predecessor) : null,
    successors: task.successors.map(toSequenceRef),
    parent: task.parentTask && !task.parentTask.deletedAt ? toSequenceRef(task.parentTask) : null,
    subtasks: task.subtasks.map(toSequenceRef),
  };
}
