// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyInstance } from "fastify";
import { isUniqueViolation } from "../../lib/prisma-errors";
import {
  createGroupSchema,
  updateGroupMembersSchema,
  updateGroupSchema,
  type Group as GroupDto,
} from "@kancrm/shared";
import { UserRole } from "@kancrm/shared";
import { prisma } from "../../db";
import { conflict, forbidden, notFound } from "../../lib/http-errors";
import { requireAdmin, requireUser } from "../../plugins/auth";
import type { User } from "../../generated/prisma/client";

const groupInclude = {
  members: { include: { user: true } },
} as const;

type GroupWithMembers = Awaited<
  ReturnType<typeof prisma.group.findMany<{ include: typeof groupInclude }>>
>[number];

function toGroupDto(group: GroupWithMembers): GroupDto {
  return {
    id: group.id,
    name: group.name,
    managedArea: (group.managedArea ?? null) as GroupDto["managedArea"],
    plugin: group.pluginNick ? { nick: group.pluginNick, chiave: group.pluginRef } : null,
    members: group.members
      .map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        isManager: membership.isManager,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}


export function groupRoutes(app: FastifyInstance): void {
  app.get("/api/groups", async (request) => {
    // L'admin vede tutti i gruppi; un manager vede i SUOI (per gestirne i membri).
    const user = requireUser(request);
    const where =
      user.role === UserRole.ADMIN
        ? undefined
        : { members: { some: { userId: user.id, isManager: true } } };
    const groups = await prisma.group.findMany({
      where,
      include: groupInclude,
      orderBy: { name: "asc" },
    });
    if (user.role !== UserRole.ADMIN && groups.length === 0) {
      throw forbidden("Riservato agli amministratori e ai manager di gruppo");
    }
    return groups.map(toGroupDto);
  });

  app.post("/api/groups", async (request, reply) => {
    requireAdmin(request);
    const input = createGroupSchema.parse(request.body);
    try {
      const group = await prisma.group.create({
        data: { name: input.name },
        include: groupInclude,
      });
      return reply.status(201).send(toGroupDto(group));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un gruppo con questo nome");
      throw error;
    }
  });

  app.patch("/api/groups/:id", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const input = updateGroupSchema.parse(request.body);

    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) throw notFound("Gruppo non trovato");

    try {
      const group = await prisma.group.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          // `null` esplicito = "non governa nessuna area": va distinto
          // dall'assenza del campo, che significa "non lo sto cambiando".
          ...(input.managedArea !== undefined ? { managedArea: input.managedArea ?? null } : {}),
        },
        include: groupInclude,
      });
      return toGroupDto(group);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Esiste già un gruppo con questo nome");
      throw error;
    }
  });

  app.delete("/api/groups/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.group.findUnique({ where: { id } });
    if (!existing) throw notFound("Gruppo non trovato");
    await prisma.group.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.put("/api/groups/:id/members", async (request) => {
    // Admin, oppure il manager del gruppo (che però non nomina né rimuove manager:
    // i flag esistenti vengono conservati e managerIds è riservato all'admin).
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    await assertCanManageGroup(user, id);
    const input = updateGroupMembersSchema.parse(request.body);

    const existing = await prisma.group.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!existing) throw notFound("Gruppo non trovato");

    const uniqueUserIds = [...new Set(input.userIds)];
    const currentManagers = new Set(
      existing.members.filter((m) => m.isManager).map((m) => m.userId),
    );
    // Solo l'admin ridefinisce i manager; per gli altri (o senza managerIds) i
    // flag correnti si conservano per i membri che restano nel gruppo.
    const managers =
      user.role === UserRole.ADMIN && input.managerIds !== undefined
        ? new Set(input.managerIds)
        : currentManagers;
    // Un manager non può togliere dal gruppo un altro manager (né sé stesso):
    // rimuovere chi lo gestisce è una decisione dell'admin.
    if (user.role !== UserRole.ADMIN) {
      const removed = existing.members.filter((m) => !uniqueUserIds.includes(m.userId));
      if (removed.some((m) => m.isManager)) {
        throw forbidden("Solo l'amministratore può rimuovere un manager dal gruppo");
      }
    }

    const group = await prisma.$transaction(async (tx) => {
      await tx.groupMember.deleteMany({ where: { groupId: id } });
      if (uniqueUserIds.length > 0) {
        await tx.groupMember.createMany({
          data: uniqueUserIds.map((userId) => ({
            groupId: id,
            userId,
            isManager: managers.has(userId),
          })),
        });
      }
      return tx.group.findUniqueOrThrow({ where: { id }, include: groupInclude });
    });
    return toGroupDto(group);
  });
}

/** Admin, oppure manager di QUESTO gruppo. */
async function assertCanManageGroup(user: User, groupId: string): Promise<void> {
  if (user.role === UserRole.ADMIN) return;
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (!membership?.isManager) {
    throw forbidden("Riservato all'amministratore o al manager del gruppo");
  }
}
