import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import {
  ActivityCategory,
  createActivityTypeSchema,
  updateActivityTypeSchema,
  type ActivityType as ActivityTypeDto,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { conflict, notFound } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";
import { assertAdminOrGroupManager, assertCanManageCategory } from "../visibility/service";
import type { ActivityType } from "../../generated/prisma/client";

// Ordine di visualizzazione delle categorie.
const CATEGORY_RANK: Record<string, number> = {
  [ActivityCategory.ADMIN]: 0,
  [ActivityCategory.SALES]: 1,
  [ActivityCategory.DEV]: 2,
  [ActivityCategory.GENERAL]: 3,
};

function toDto(type: ActivityType): ActivityTypeDto {
  return {
    id: type.id,
    name: type.name,
    category: type.category as ActivityTypeDto["category"],
    color: type.color,
    order: type.order,
    isMeeting: type.isMeeting,
  };
}

export function activityTypeRoutes(app: FastifyInstance): void {
  app.get("/api/activity-types", async (request) => {
    requireUser(request);
    const types = await prisma.activityType.findMany({ where: { isActive: true } });
    // Ordina per categoria (rank) e poi per ordine interno.
    types.sort(
      (a, b) =>
        (CATEGORY_RANK[a.category] ?? 99) - (CATEGORY_RANK[b.category] ?? 99) || a.order - b.order,
    );
    return types.map(toDto);
  });

  // --- Configurazione (admin o manager di gruppo) ---

  app.post("/api/activity-types", async (request, reply) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const input = createActivityTypeSchema.parse(request.body);
    await assertCanManageCategory(user, input.category);
    const last = await prisma.activityType.findFirst({ orderBy: { order: "desc" } });
    try {
      const type = await prisma.activityType.create({
        data: { ...input, order: (last?.order ?? -1) + 1 },
      });
      return reply.status(201).send(toDto(type));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un tipo con questo nome");
      throw error;
    }
  });

  app.patch("/api/activity-types/:id", async (request) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const input = updateActivityTypeSchema.parse(request.body);
    const existing = await prisma.activityType.findUnique({ where: { id } });
    if (!existing || !existing.isActive) throw notFound("Tipo di attività non trovato");
    await assertCanManageCategory(user, existing.category as ActivityCategory);
    try {
      const type = await prisma.activityType.update({ where: { id }, data: input });
      return toDto(type);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un tipo con questo nome");
      throw error;
    }
  });

  // Eliminazione: se il tipo è usato da task o ricorrenze viene DISATTIVATO
  // (sparisce dalle tendine, i task esistenti lo conservano); se mai usato si
  // elimina davvero.
  app.delete("/api/activity-types/:id", async (request, reply) => {
    const user = requireUser(request);
    await assertAdminOrGroupManager(user);
    const { id } = request.params as { id: string };
    const existing = await prisma.activityType.findUnique({
      where: { id },
      include: { _count: { select: { tasks: true, recurrenceTemplates: true } } },
    });
    if (!existing || !existing.isActive) throw notFound("Tipo di attività non trovato");
    await assertCanManageCategory(user, existing.category as ActivityCategory);
    if (existing._count.tasks > 0 || existing._count.recurrenceTemplates > 0) {
      await prisma.activityType.update({ where: { id }, data: { isActive: false } });
    } else {
      await prisma.activityType.delete({ where: { id } });
    }
    return reply.status(204).send();
  });
}

