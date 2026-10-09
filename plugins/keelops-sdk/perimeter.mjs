/**
 * The task visibility perimeter, in a CONSERVATIVE version for plugins.
 *
 * The real rule lives in the core (`modules/visibility/task-perimeter.ts`) and
 * has nuances not replicated here (per-group scopes, area managers, the
 * developers' "days" lens). This is the tighter-mesh version: when in doubt,
 * DENY. A plugin may show less than it could, never more. When the plugin
 * host grows real service APIs, this copy disappears in their favour.
 *
 * Who sees what:
 *  - ADMIN: everything (minus the trash);
 *  - MEMBER: their own tasks (created/assigned/supervised), the tasks of the
 *    projects they are members of, every ticket (a declared product choice:
 *    the internal desk sees all tickets), NEVER other people's deals, NEVER
 *    other people's personal tasks.
 */

/**
 * Support requests exist only where the core has the `ticket` function
 * (08/10/2026): on a community core started on a commercial database the
 * TICKET rows are there, and stay out. A user object without `funzioni` (an
 * older core, standalone mode) keeps the rule as it was.
 */
const ticketsExist = (user) => !user.funzioni || user.funzioni.has("ticket");

/** @returns {{where: string, params: string[]}} an AND filter over Task t */
export function taskPerimeter(user) {
  const noTickets = ticketsExist(user) ? "" : " AND t.kind <> 'TICKET'";
  if (user.role === "ADMIN") return { where: `t.deletedAt IS NULL${noTickets}`, params: [] };
  return {
    where: `t.deletedAt IS NULL${noTickets} AND (
      t.creatorId = ? OR t.assigneeId = ? OR t.supervisorId = ?
      OR (t.kind = 'TICKET')
      OR (t.kind = 'PROJECT' AND t.projectId IN (
            SELECT pm.projectId FROM ProjectMember pm WHERE pm.userId = ?))
    ) AND NOT (t.kind = 'DEAL' AND t.creatorId <> ? AND (t.assigneeId IS NULL OR t.assigneeId <> ?))
      AND NOT (t.kind = 'PERSONAL' AND t.creatorId <> ? AND (t.assigneeId IS NULL OR t.assigneeId <> ?))`,
    params: [user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id],
  };
}

/** The projects a user may open in the map: their memberships, or all for admins. */
export function projectPerimeter(user) {
  if (user.role === "ADMIN") return { where: "p.deletedAt IS NULL", params: [] };
  return {
    where: `p.deletedAt IS NULL AND (
      p.id IN (SELECT pm.projectId FROM ProjectMember pm WHERE pm.userId = ?)
      OR p.id IN (SELECT t2.projectId FROM Task t2 WHERE t2.projectId IS NOT NULL
                  AND (t2.assigneeId = ? OR t2.supervisorId = ?) AND t2.deletedAt IS NULL))`,
    params: [user.id, user.id, user.id],
  };
}
