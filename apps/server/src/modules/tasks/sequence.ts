import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";

/**
 * Impedisce i cicli nella catena dei propedeutici: risalendo da `predecessorId`
 * non si deve mai incontrare `taskId`.
 */
export async function assertNoSequenceCycle(taskId: string, predecessorId: string): Promise<void> {
  if (taskId === predecessorId) {
    throw badRequest("Un task non può essere propedeutico di se stesso");
  }
  const visited = new Set<string>();
  let current: string | null = predecessorId;
  while (current) {
    if (current === taskId) {
      throw badRequest("La catena creerebbe un ciclo tra i task propedeutici");
    }
    if (visited.has(current)) break;
    visited.add(current);
    const task: { predecessorId: string | null } | null = await prisma.task.findUnique({
      where: { id: current },
      select: { predecessorId: true },
    });
    current = task?.predecessorId ?? null;
  }
}

/**
 * Risale la catena dei propedeutici e restituisce i titoli di quelli non ancora
 * completati (stato non "chiuso"), dal più vicino al più lontano.
 */
export async function findOpenPredecessors(taskId: string): Promise<string[]> {
  const open: string[] = [];
  const visited = new Set<string>([taskId]);
  const start: { predecessorId: string | null } | null = await prisma.task.findUnique({
    where: { id: taskId },
    select: { predecessorId: true },
  });
  let current: string | null = start?.predecessorId ?? null;
  while (current && !visited.has(current)) {
    visited.add(current);
    // findFirst con deletedAt esplicito: un propedeutico nel cestino non blocca,
    // ma la catena prosegue attraverso di lui.
    const task: {
      title: string;
      predecessorId: string | null;
      deletedAt: Date | null;
      status: { isClosed: boolean } | null;
    } | null = await prisma.task.findFirst({
      where: { id: current, deletedAt: undefined },
      select: {
        title: true,
        predecessorId: true,
        deletedAt: true,
        status: { select: { isClosed: true } },
      },
    });
    if (!task) break;
    if (!(task.status?.isClosed ?? false) && task.deletedAt === null) open.push(task.title);
    current = task.predecessorId;
  }
  return open;
}
