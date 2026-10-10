// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import {
  ActivityCategory,
  createTaskStatusSchema,
  mergeTaskStatusSchema,
  reorderTaskStatusesSchema,
  updateTaskStatusSchema,
  type TaskStatus as TaskStatusDto,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { assertAdminOrGroupManager, assertCanManageCategory } from "../visibility/service";
import { mergeTaskStatus, previewMerge } from "./merge";
import type { TaskStatus } from "../../generated/prisma/client";

function toDto(status: TaskStatus): TaskStatusDto {
  return {
    id: status.id,
    name: status.name,
    category: status.category as TaskStatusDto["category"],
    color: status.color,
    order: status.order,
    isClosed: status.isClosed,
    isWonTarget: status.isWonTarget,
    isAssignedTarget: status.isAssignedTarget,
    stopsRecurrence: status.stopsRecurrence,
    isBillingMilestone: status.isBillingMilestone,
    wipLimit: status.wipLimit,
  };
}


export function taskStatusRoutes(app: FastifyInstance): void {
  app.get("/api/task-statuses", async (request) => {
    requireUser(request);
    const statuses = await prisma.taskStatus.findMany({
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    return statuses.map(toDto);
  });

  app.post("/api/task-statuses", async (request, reply) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const input = createTaskStatusSchema.parse(request.body);
    await assertCanManageCategory(user, input.category);
    const last = await prisma.taskStatus.findFirst({
      where: { category: input.category },
      orderBy: { order: "desc" },
    });
    try {
      const status = await prisma.taskStatus.create({
        data: { ...input, order: (last?.order ?? -1) + 1 },
      });
      return reply.status(201).send(toDto(status));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("Esiste già uno stato con questo nome in questa categoria");
      }
      throw error;
    }
  });

  app.patch("/api/task-statuses/:id", async (request) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const input = updateTaskStatusSchema.parse(request.body);
    const existing = await prisma.taskStatus.findUnique({ where: { id } });
    if (!existing) throw notFound("Stato non trovato");
    await assertCanManageCategory(user, existing.category as ActivityCategory);
    // Il contrassegno "task da offerta vinta" è unico e vive tra gli amministrativi:
    // il task generato è un task dello scadenzario.
    if (input.isWonTarget) {
      if (existing.category !== ActivityCategory.ADMIN) {
        throw badRequest("Solo uno stato amministrativo può ricevere le offerte vinte");
      }
      await prisma.taskStatus.updateMany({
        where: { isWonTarget: true, id: { not: id } },
        data: { isWonTarget: false },
      });
    }
    // Lo stato dei task assegnati è uno per categoria.
    if (input.isAssignedTarget) {
      if (existing.isClosed) {
        throw badRequest("Uno stato chiuso non può essere lo stato dei task assegnati");
      }
      await prisma.taskStatus.updateMany({
        where: { category: existing.category, isAssignedTarget: true, id: { not: id } },
        data: { isAssignedTarget: false },
      });
    }
    // "Interrompe la ricorrenza" vale solo per uno stato chiuso; se lo stato è (o
    // diventa) aperto, il flag non ha senso e viene azzerato.
    const willBeClosed = input.isClosed ?? existing.isClosed;
    if (input.stopsRecurrence && !willBeClosed) {
      throw badRequest("Solo uno stato chiuso può interrompere la ricorrenza");
    }
    const data = !willBeClosed ? { ...input, stopsRecurrence: false } : input;
    try {
      const status = await prisma.taskStatus.update({ where: { id }, data });
      return toDto(status);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("Esiste già uno stato con questo nome in questa categoria");
      }
      throw error;
    }
  });

  app.delete("/api/task-statuses/:id", async (request, reply) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const existing = await prisma.taskStatus.findUnique({
      where: { id },
      include: { _count: { select: { tasks: true } } },
    });
    if (!existing) throw notFound("Stato non trovato");
    await assertCanManageCategory(user, existing.category as ActivityCategory);
    if (existing._count.tasks > 0) {
      throw badRequest(
        'Lo stato "{{status}}" è usato da {{count}} task: spostali prima di eliminarlo',
        { status: existing.name, count: existing._count.tasks },
      );
    }
    const remaining = await prisma.taskStatus.count({ where: { category: existing.category } });
    if (remaining <= 1) {
      throw badRequest("Ogni categoria deve avere almeno uno stato");
    }
    await prisma.taskStatus.delete({ where: { id } });
    return reply.status(204).send();
  });

  /**
   * Cosa succederebbe fondendo due stati. È una lettura, ma sta su POST perché
   * i due stati sono l'oggetto della domanda e non un filtro: la si chiama
   * mentre si scelgono le tendine, prima di qualunque conferma.
   */
  app.post("/api/task-statuses/:id/merge-preview", async (request) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const { targetId } = mergeTaskStatusSchema.parse(request.body);
    const preview = await previewMerge(id, targetId);
    await assertCanManageCategory(user, preview.category);
    return preview;
  });

  /**
   * La fusione. Chi la chiede ha già visto quanti record cambieranno e ha
   * confermato due volte in pagina: qui non si chiede più niente, si scrive —
   * ma il permesso si ricontrolla, perché una conferma nel browser non è un
   * permesso.
   */
  app.post("/api/task-statuses/:id/merge", async (request) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const { targetId } = mergeTaskStatusSchema.parse(request.body);
    const preview = await previewMerge(id, targetId);
    await assertCanManageCategory(user, preview.category);
    return mergeTaskStatus(user, id, targetId);
  });

  app.put("/api/task-statuses/reorder", async (request) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { ids } = reorderTaskStatusesSchema.parse(request.body);
    // Il riordino avviene dentro una categoria: l'elenco deve contenerne tutti
    // gli stati e nessuno di un'altra.
    const statuses = await prisma.taskStatus.findMany({ where: { id: { in: ids } } });
    const category = statuses[0]?.category;
    if (statuses.length !== ids.length || !category) {
      throw badRequest("Elenco di stati non valido");
    }
    if (statuses.some((status) => status.category !== category)) {
      throw badRequest("Gli stati da riordinare devono appartenere alla stessa categoria");
    }
    await assertCanManageCategory(user, category as ActivityCategory);
    const inCategory = await prisma.taskStatus.count({ where: { category } });
    if (inCategory !== ids.length) {
      throw badRequest("L'elenco deve contenere tutti gli stati della categoria");
    }
    await prisma.$transaction(
      ids.map((id, index) => prisma.taskStatus.update({ where: { id }, data: { order: index } })),
    );
    const updated = await prisma.taskStatus.findMany({
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });
    return updated.map(toDto);
  });
}
