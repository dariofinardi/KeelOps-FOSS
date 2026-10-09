import type { FastifyInstance } from "fastify";
import { createTagSchema, type Tag as TagDto } from "@kancrm/shared";
import { prisma } from "../../db";
import { conflict } from "../../lib/http-errors";
import { requireUser } from "../../plugins/auth";

/** Etichette libere sui task: elenco per i selettori e creazione al volo. */
export function tagRoutes(app: FastifyInstance): void {
  app.get("/api/tags", async (request) => {
    requireUser(request);
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { tasks: true } } },
    });
    return tags.map((tag): TagDto => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      taskCount: tag._count.tasks,
    }));
  });

  app.post("/api/tags", async (request, reply) => {
    requireUser(request);
    const input = createTagSchema.parse(request.body);
    const name = input.name.trim();
    // Deduplicati per nome: se esiste già, restituisci quello (upsert-like).
    const existing = await prisma.tag.findUnique({ where: { name } });
    if (existing) {
      return { id: existing.id, name: existing.name, color: existing.color, taskCount: 0 };
    }
    try {
      const tag = await prisma.tag.create({ data: { name, color: input.color ?? null } });
      return reply.status(201).send({ id: tag.id, name: tag.name, color: tag.color, taskCount: 0 });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw conflict("Esiste già un tag con questo nome");
      }
      throw error;
    }
  });
}
