// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { NotificationType, TaskKind } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, notFound } from "../../lib/http-errors";
import type { User } from "../../generated/prisma/client";
import { taskDetailInclude } from "./serializers";
import { notify } from "../notifications/service";
import { assertProjectEdit, assertProjectManage } from "../projects/access";
import { assertCanSeeDeals } from "../visibility/service";

/** YYYY-MM-DD → DateTime a mezzanotte UTC. */
export function parseDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/** Nomi risolti al momento del log: restano leggibili anche dopo rinomine. */
export async function userName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return user?.name ?? null;
}

export async function activityTypeName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const type = await prisma.activityType.findUnique({ where: { id }, select: { name: true } });
  return type?.name ?? null;
}

export async function taskTitle(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const task = await prisma.task.findUnique({ where: { id }, select: { title: true } });
  return task?.title ?? null;
}

export async function ensureUserExists(id: string, label: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.isActive) throw badRequest("{{label}} non valido", { label });
}

export async function ensureActivityType(id: string): Promise<void> {
  const type = await prisma.activityType.findUnique({ where: { id } });
  if (!type) throw badRequest("Tipo di attività non valido");
}

/**
 * Verifica che l'id indicato sia davvero un incontro: un task il cui tipo
 * attività ha isMeeting. Ritorna l'id validato (o null se non indicato).
 */
export async function ensureMeeting(meetingId: string | null | undefined): Promise<string | null> {
  if (!meetingId) return null;
  const meeting = await prisma.task.findUnique({
    where: { id: meetingId },
    include: { activityType: true },
  });
  if (!meeting || !meeting.activityType?.isMeeting) {
    throw badRequest("Riunione non valida: scegliere un task di tipo riunione");
  }
  return meeting.id;
}

export async function loadTaskDetail(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskDetailInclude });
  if (!task) throw notFound("Task non trovato");
  return task;
}

export async function notifyAssignment(
  task: { id: string; title: string; kind: string },
  assigneeId: string,
  actor: User,
) {
  await notify(assigneeId, actor.id, NotificationType.TASK_ASSIGNED, {
    message: (t) =>
      t('{{actor}} ti ha assegnato il task "{{title}}"', {
        actor: actor.name,
        title: task.title,
      }),
    taskId: task.id,
    taskKind: task.kind as TaskKind,
  });
}

/**
 * Spostamento di contesto di un task: dentro/fuori un progetto, o collegamento a
 * un'offerta. Vale solo per i task "normali" — restano fuori:
 *
 *  - offerte e ticket: non sono task che si spostano (l'offerta ha campi propri,
 *    il ticket ha un richiedente esterno che perderebbe il filo);
 *  - le occorrenze di una ricorrenza: il template continua a generarle nello
 *    scadenzario, spostarne una sola spezzerebbe la serie;
 *  - i subtask e i task che ne hanno: la gerarchia esiste solo dentro i progetti.
 *
 * Restituisce il nuovo `kind`, o null se non è uno spostamento.
 */
export async function resolveMove(
  user: User,
  existing: {
    id: string;
    kind: string;
    projectId: string | null;
    parentTaskId: string | null;
    recurrenceTemplateId: string | null;
  },
  input: { projectId?: string | null; relatedDealId?: string | null },
): Promise<string | null> {
  const movesProject = input.projectId !== undefined && input.projectId !== existing.projectId;
  const linksDeal = input.relatedDealId !== undefined;
  if (!movesProject && !linksDeal) return null;

  if (existing.kind !== TaskKind.ADMIN && existing.kind !== TaskKind.PROJECT) {
    throw badRequest("Solo i task dello scadenzario e dei progetti si possono spostare");
  }
  if (existing.recurrenceTemplateId) {
    throw badRequest(
      "È l'occorrenza di una ricorrenza: sposta la ricorrenza, non la singola scadenza",
    );
  }
  if (existing.parentTaskId) {
    throw badRequest("Un subtask resta nel progetto del task padre");
  }
  const subtasks = await prisma.task.count({ where: { parentTaskId: existing.id } });
  if (subtasks > 0) {
    throw badRequest("Ha {{count}} subtask: la gerarchia esiste solo dentro un progetto", {
      count: subtasks,
    });
  }

  if (movesProject) {
    // Entrare in un progetto richiede di poterci lavorare; uscirne è più delicato
    // (sottrae il task alla vista del team), quindi serve il manager.
    if (input.projectId) await assertProjectEdit(user, input.projectId);
    if (existing.projectId) await assertProjectManage(user, existing.projectId);
  }
  if (linksDeal && input.relatedDealId) {
    await assertCanSeeDeals(user);
    const deal = await prisma.task.findUnique({ where: { id: input.relatedDealId } });
    if (!deal || deal.kind !== TaskKind.DEAL) throw badRequest("Offerta non valida");
  }

  const projectId = input.projectId !== undefined ? input.projectId : existing.projectId;
  return projectId ? TaskKind.PROJECT : TaskKind.ADMIN;
}
