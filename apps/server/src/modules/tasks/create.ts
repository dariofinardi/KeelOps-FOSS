import { NotificationType, TaskKind, VisibilityScope, type CreateTaskInput } from "@kancrm/shared";
import { prisma } from "../../db";
import type { User } from "../../generated/prisma/client";
import { badRequest } from "../../lib/http-errors";
import { assertCanSeeDeals, canSeeScope } from "../visibility/service";
import { assertProjectEdit } from "../projects/access";
import {
  assertStatusInCategory,
  initialStatusFor,
  requireInitialStatusId,
  statusCategoryOfTask,
} from "../task-statuses/service";
import {
  ensureActivityType,
  ensureMeeting,
  ensureUserExists,
  notifyAssignment,
  parseDueDate,
} from "./common";
import { logActivity } from "./activity";
import { bindPendingImages } from "../rich-text/inline-images";
import { notify } from "../notifications/service";

/**
 * Creazione di un task, qualunque sia la porta d'ingresso: la rotta web
 * (`POST /api/tasks`) e l'API delle integrazioni passano ENTRAMBE da qui, così
 * regole e difese restano scritte una volta — stati iniziali per categoria,
 * referente di default, perimetro ADMIN_TASKS, notifiche.
 *
 * `companyId` non è nel form web (l'azienda del task segue offerta/progetto,
 * vedi tasks/company.ts): lo passa solo l'API delle integrazioni, che crea
 * scadenze amministrative intestate a un cliente.
 */
export async function createTaskAs(
  user: User,
  input: CreateTaskInput & { companyId?: string | null },
) {

// Contesto del task:
//  - progetto (EDITOR+ sul progetto): task PROJECT visibile ai membri;
//  - offerta (relatedDealId): task ADMIN personale collegato a un'offerta;
//  - altrimenti: task ADMIN personale (scadenzario).
let kind: string = TaskKind.ADMIN;
let relatedDealId: string | null = null;
// Senza lo scope ADMIN_TASKS il task è personale: assegnato a sé, non ad altri.
const seesAllAdmin = await canSeeScope(user, VisibilityScope.ADMIN_TASKS);

if (input.projectId) {
  if (input.relatedDealId) {
    throw badRequest("Un task può appartenere a un progetto oppure a un'offerta, non entrambi");
  }
  await assertProjectEdit(user, input.projectId);
  kind = TaskKind.PROJECT;
  if (input.parentTaskId) {
    const parent = await prisma.task.findUnique({ where: { id: input.parentTaskId } });
    if (!parent || parent.projectId !== input.projectId) {
      throw badRequest("Task padre non valido");
    }
    if (parent.parentTaskId) {
      throw badRequest("I subtask hanno un solo livello: il padre è già un subtask");
    }
  }
} else {
  if (input.parentTaskId) throw badRequest("I subtask esistono solo nei progetti");
  // Task collegato a un'offerta: serve poter vedere il modulo Offerte.
  if (input.relatedDealId) {
    await assertCanSeeDeals(user);
    const deal = await prisma.task.findUnique({ where: { id: input.relatedDealId } });
    if (!deal || deal.kind !== TaskKind.DEAL) throw badRequest("Offerta non valida");
    relatedDealId = deal.id;
  }
}

// Gli stati disponibili dipendono dalla categoria del tipo di attività
// (un fix di sviluppo non segue il flusso di una scadenza fiscale).
const statusCategory = await statusCategoryOfTask({
  activityTypeId: input.activityTypeId,
  kind,
});
// Owner = creatore (creatorId). L'assegnatario si può lasciare vuoto: sarà il
// primo che lavora il task a prenderlo in carico. Senza lo scope ADMIN_TASKS non
// si assegnano task ad altri (al massimo a sé).
const personalAdmin = kind === TaskKind.ADMIN && !seesAllAdmin;
let assigneeId = input.assigneeId ?? null;
if (personalAdmin && assigneeId && assigneeId !== user.id) assigneeId = null;
// Referente di default = chi crea. Un task senza supervisore non ha nessuno
// che ne risponde, e i "veloci" (aggiungi task da un'offerta, dal progetto)
// nascevano orfani. Chi non lo vuole manda esplicitamente null dal pannello:
// campo assente ≠ campo svuotato.
const supervisorId = input.supervisorId === undefined ? user.id : (input.supervisorId ?? null);

let statusId = input.statusId;
if (statusId) {
  await assertStatusInCategory(statusId, statusCategory);
} else {
  // Con un assegnatario il task nasce già nello stato dei task assegnati,
  // se la categoria ne ha uno: "Da assegnare" su un task assegnato è falso.
  const first = await initialStatusFor(statusCategory, assigneeId);
  if (!first) statusId = await requireInitialStatusId(statusCategory);
  else statusId = first.id;
}

if (assigneeId) await ensureUserExists(assigneeId, "Assegnatario");
if (supervisorId) await ensureUserExists(supervisorId, "Supervisore");
if (input.predecessorId) {
  const predecessor = await prisma.task.findUnique({ where: { id: input.predecessorId } });
  if (!predecessor) throw badRequest("Task propedeutico non valido");
}
if (input.activityTypeId) await ensureActivityType(input.activityTypeId);
const meetingId = await ensureMeeting(input.meetingId);

const task = await prisma.$transaction(async (tx) => {
  const created = await tx.task.create({
    data: {
      kind,
      title: input.title,
      description: input.description ?? null,
      statusId: statusId,
      activityTypeId: input.activityTypeId ?? null,
      creatorId: user.id,
      assigneeId,
      supervisorId,
      dueDate: parseDueDate(input.dueDate) ?? null,
      // L'orario esiste solo insieme a una data.
      dueTime: input.dueDate ? (input.dueTime ?? null) : null,
      predecessorId: input.predecessorId ?? null,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      relatedDealId,
      companyId: input.companyId ?? null,
      meetingId,
      participants: input.participants ?? null,
      ...(input.tagIds && input.tagIds.length > 0
        ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
        : {}),
    },
  });
  await logActivity(tx, created.id, user.id, "created");
  return created;
});
// Le figure incollate mentre il task non esisteva ancora: ora esiste, e
// traslocano accanto a lui (vedi rich-text/inline-images.ts). Fuori dalla
// transazione di proposito: sono file su disco, e su SQLite tenere il lock
// in scrittura durante l'I/O bloccherebbe tutti gli altri.
await bindPendingImages(user.id, task.id, task.description);
// Nessuna notifica se ci si assegna il proprio task.
if (task.assigneeId && task.assigneeId !== user.id) {
  await notifyAssignment(task, task.assigneeId, user);
}
// Anche chi è stato messo a seguire il task deve saperlo subito: prima lo
// scopriva solo al primo cambio di stato.
if (task.supervisorId && task.supervisorId !== user.id) {
  await notify(task.supervisorId, user.id, NotificationType.SUPERVISED_STATUS_CHANGED, {
    message: (t) =>
      t('{{actor}} ti ha messo come referente di "{{title}}"', {
        actor: user.name,
        title: task.title,
      }),
    taskId: task.id,
    taskKind: task.kind as TaskKind,
  });
}

  return task;
}
