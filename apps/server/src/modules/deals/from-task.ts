import { ProjectRole, TaskKind, UserRole, type ActivityCategory } from "@kancrm/shared";
import { prisma } from "../../db";
import type { User } from "../../generated/prisma/client";
import { manageableCategories } from "../visibility/service";

/**
 * **Chi crea un'offerta a partire da un task** (06/10/2026): chi quel lavoro lo
 * governa e quindi sa che va venduto — il manager del progetto del task (o di
 * quello a cui rimanda), il manager dell'area in cui il task vive (lo stato dice
 * l'area: sviluppo, amministrazione, assistenza…), o un amministratore.
 *
 * Non serve l'accesso alle Offerte: un manager dello sviluppo le vede spesso
 * solo in «Giornate». Crea l'offerta e la affida a un commerciale (o a sé), e
 * resta il suo autore. Che il task lo veda davvero lo controlla chi chiama.
 */
export interface TaskPerOfferta {
  kind: string;
  projectId: string | null;
  relatedProjectId: string | null;
  status: { category: string } | null;
}

export async function puoCreareOffertaDaTask(user: User, task: TaskPerOfferta): Promise<boolean> {
  if (task.kind === TaskKind.DEAL) return false;
  if (user.role === UserRole.ADMIN) return true;
  const progetti = [task.projectId, task.relatedProjectId].filter((id): id is string =>
    Boolean(id),
  );
  if (progetti.length > 0) {
    const manager = await prisma.projectMember.findFirst({
      where: { userId: user.id, projectId: { in: progetti }, role: ProjectRole.MANAGER },
      select: { projectId: true },
    });
    if (manager) return true;
  }
  if (!task.status) return false;
  return (await manageableCategories(user)).has(task.status.category as ActivityCategory);
}
