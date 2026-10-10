// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prismaRaw } from "../../db";
import { requireAdmin } from "../../plugins/auth";
import { emptyTrash, hardDelete, restore, type TrashType } from "./service";

const trashTypeSchema = z.enum(["task", "project", "company", "contact"]);

export interface TrashItem {
  type: TrashType;
  id: string;
  label: string;
  context: string;
  deletedAt: string;
}

/** Cestino (solo admin): elenco, ripristino, eliminazione definitiva. */
export function trashRoutes(app: FastifyInstance): void {
  app.get("/api/trash", async (request) => {
    requireAdmin(request);
    const [tasks, projects, companies, contacts] = await Promise.all([
      prismaRaw.task.findMany({
        where: { deletedAt: { not: null } },
        include: { project: true },
        orderBy: { deletedAt: "desc" },
        take: 200,
      }),
      prismaRaw.project.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
      }),
      prismaRaw.company.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
      }),
      prismaRaw.contact.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
      }),
    ]);

    const kindLabel: Record<string, string> = {
      ADMIN: "Task",
      PROJECT: "Task di progetto",
      DEAL: "Offerta",
      TICKET: "Ticket",
      PERSONAL: "Task personale",
    };
    const items: TrashItem[] = [
      ...tasks.map((task) => ({
        type: "task" as const,
        id: task.id,
        label: task.title,
        context: task.parentTaskId
          ? `Subtask${task.project ? ` · ${task.project.name}` : ""}`
          : (kindLabel[task.kind] ?? "Task") + (task.project ? ` · ${task.project.name}` : ""),
        deletedAt: task.deletedAt!.toISOString(),
      })),
      ...projects.map((project) => ({
        type: "project" as const,
        id: project.id,
        label: project.name,
        context: "Progetto (con i suoi task)",
        deletedAt: project.deletedAt!.toISOString(),
      })),
      ...companies.map((company) => ({
        type: "company" as const,
        id: company.id,
        label: company.name,
        context: "Azienda",
        deletedAt: company.deletedAt!.toISOString(),
      })),
      ...contacts.map((contact) => ({
        type: "contact" as const,
        id: contact.id,
        label: `${contact.firstName} ${contact.lastName}`,
        context: "Contatto",
        deletedAt: contact.deletedAt!.toISOString(),
      })),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

    return { items };
  });

  app.post("/api/trash/restore", async (request, reply) => {
    const admin = requireAdmin(request);
    const input = z.object({ type: trashTypeSchema, id: z.string() }).parse(request.body);
    await restore(input.type, input.id);
    // Il ripristino resta nella cronologia del task, accanto all'eliminazione.
    if (input.type === "task") {
      await prismaRaw.activityLog.create({
        data: { taskId: input.id, userId: admin.id, action: "restored", payload: null },
      });
    }
    return reply.status(204).send();
  });

  // Svuotamento manuale: elimina definitivamente tutto. Irreversibile, solo admin.
  app.delete("/api/trash", async (request) => {
    const admin = requireAdmin(request);
    const purged = await emptyTrash();
    request.log.warn({ by: admin.id, purged }, "Cestino svuotato");
    return { purged };
  });

  app.delete("/api/trash/:type/:id", async (request, reply) => {
    requireAdmin(request);
    const params = z.object({ type: trashTypeSchema, id: z.string() }).parse(request.params);
    await hardDelete(params.type, params.id);
    return reply.status(204).send();
  });
}
