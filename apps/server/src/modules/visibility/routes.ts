import type { FastifyInstance } from "fastify";
import { UserRole, VisibilityScope, updateVisibilitySchema } from "@kancrm/shared";
import { prisma } from "../../db";
import { notFound } from "../../lib/http-errors";
import { requireAdmin } from "../../plugins/auth";
import { accessForScope } from "./service";

export function visibilityRoutes(app: FastifyInstance): void {
  /**
   * "Chi vede cosa": accesso EFFETTIVO di un utente, modulo per modulo, come
   * risulta dai suoi gruppi (vince il livello più permissivo). Serve all'admin
   * per rispondere a colpo d'occhio a "perché Tizio (non) vede questo?" senza
   * ricostruire a mano la matrice gruppi × moduli. Le regole personali restano
   * comunque valide: un task assegnato si vede e si lavora in ogni caso.
   */
  app.get("/api/users/:id/access", async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("Utente non trovato");

    const scopes: Record<string, string | null> = {};
    for (const scope of Object.values(VisibilityScope)) {
      scopes[scope] = await accessForScope(user, scope);
    }
    const managerOf = await prisma.groupMember.findMany({
      where: { userId: id, isManager: true },
      include: { group: { select: { name: true } } },
    });
    return {
      userId: id,
      isAdmin: user.role === UserRole.ADMIN,
      isPortal: user.role === UserRole.PORTAL,
      scopes,
      managerOf: managerOf.map((m) => m.group.name).sort(),
      canViewAllTimesheets: user.canViewAllTimesheets,
    };
  });

  // { DEALS: [{ groupId, access }...], ADMIN_TASKS: [...], ... }
  app.get("/api/visibility-settings", async (request) => {
    requireAdmin(request);
    const settings = await prisma.visibilitySetting.findMany();
    const result: Record<string, Array<{ groupId: string; access: string }>> = {};
    for (const setting of settings) {
      (result[setting.scope] ??= []).push({ groupId: setting.groupId, access: setting.access });
    }
    return result;
  });

  app.put("/api/visibility-settings", async (request) => {
    requireAdmin(request);
    const input = updateVisibilitySchema.parse(request.body);
    // Un solo record per (scope, gruppo): tiene l'ultimo livello indicato.
    const byGroup = new Map(input.groups.map((g) => [g.groupId, g.access]));
    await prisma.$transaction(async (tx) => {
      await tx.visibilitySetting.deleteMany({ where: { scope: input.scope } });
      if (byGroup.size > 0) {
        await tx.visibilitySetting.createMany({
          data: [...byGroup].map(([groupId, access]) => ({ scope: input.scope, groupId, access })),
        });
      }
    });
    const settings = await prisma.visibilitySetting.findMany({ where: { scope: input.scope } });
    return {
      scope: input.scope,
      groups: settings.map((s) => ({ groupId: s.groupId, access: s.access })),
    };
  });
}

export { VisibilityScope };
