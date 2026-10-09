import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import {
  createDealStageSchema,
  reorderTaskStatusesSchema,
  updateDealStageSchema,
  type DealStage as DealStageDto,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import { requireAdmin, requireUser } from "../../plugins/auth";
import type { DealStage } from "../../generated/prisma/client";
import { assertCanSeeDeals, hasDealsDaysLens } from "../visibility/service";

export function toStageDto(stage: DealStage): DealStageDto {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isWon: stage.isWon,
    isLost: stage.isLost,
    wonTaskStatusId: stage.wonTaskStatusId,
    wonTaskAssigneeId: stage.wonTaskAssigneeId,
  };
}


export function dealStageRoutes(app: FastifyInstance): void {
  app.get("/api/deal-stages", async (request) => {
    const user = requireUser(request);
    // Nomi, colori e ordine delle fasi: servono anche a chi vede l'elenco in
    // giornate, per i badge e il filtro per fase.
    if (!(await hasDealsDaysLens(user))) await assertCanSeeDeals(user);
    const stages = await prisma.dealStage.findMany({ orderBy: { order: "asc" } });
    return stages.map(toStageDto);
  });

  app.post("/api/deal-stages", async (request, reply) => {
    requireAdmin(request);
    const input = createDealStageSchema.parse(request.body);
    const last = await prisma.dealStage.findFirst({ orderBy: { order: "desc" } });
    try {
      const stage = await prisma.dealStage.create({
        data: { ...input, order: (last?.order ?? -1) + 1 },
      });
      return reply.status(201).send(toStageDto(stage));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già una fase con questo nome");
      throw error;
    }
  });

  app.patch("/api/deal-stages/:id", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const input = updateDealStageSchema.parse(request.body);
    const existing = await prisma.dealStage.findUnique({ where: { id } });
    if (!existing) throw notFound("Fase non trovata");
    try {
      const stage = await prisma.dealStage.update({ where: { id }, data: input });
      return toStageDto(stage);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già una fase con questo nome");
      throw error;
    }
  });

  app.delete("/api/deal-stages/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.dealStage.findUnique({
      where: { id },
      include: { _count: { select: { deals: true } } },
    });
    if (!existing) throw notFound("Fase non trovata");
    if (existing._count.deals > 0) {
      throw badRequest(
        'La fase "{{stage}}" è usata da {{count}} offerte: spostale prima di eliminarla',
        { stage: existing.name, count: existing._count.deals },
      );
    }
    await prisma.dealStage.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.put("/api/deal-stages/reorder", async (request) => {
    requireAdmin(request);
    const { ids } = reorderTaskStatusesSchema.parse(request.body);
    const stages = await prisma.dealStage.findMany();
    const known = new Set(stages.map((s) => s.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw badRequest("L'elenco deve contenere tutte le fasi esistenti");
    }
    await prisma.$transaction(
      ids.map((id, index) => prisma.dealStage.update({ where: { id }, data: { order: index } })),
    );
    const updated = await prisma.dealStage.findMany({ orderBy: { order: "asc" } });
    return updated.map(toStageDto);
  });
}
