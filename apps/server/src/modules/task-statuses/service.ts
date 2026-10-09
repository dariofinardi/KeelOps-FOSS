import { ActivityCategory, equivalentStatusId, statusCategoryOf } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";

/**
 * Gli stati sono divisi per categoria di attività: il flusso di una telefonata
 * commerciale non è quello di una scadenza fiscale. La categoria di un task è
 * quella del suo tipo di attività; senza tipo (offerte, ticket, task generici)
 * valgono gli stati GENERAL.
 */

/**
 * Categoria degli stati validi per un task: quella del tipo di attività; senza
 * tipo, quella del modulo (scadenzario → ADMIN, il resto → GENERAL).
 */
export async function statusCategoryOfTask(task: {
  activityTypeId?: string | null;
  kind?: string;
}): Promise<ActivityCategory> {
  const activityType = task.activityTypeId
    ? await prisma.activityType.findUnique({
        where: { id: task.activityTypeId },
        select: { category: true },
      })
    : null;
  return statusCategoryOf({ activityType, kind: task.kind });
}

/**
 * Stato con cui nasce un task: il primo APERTO della categoria. L'admin può
 * riordinare gli stati e mettere in testa un "Annullato": un task nuovo non deve
 * comunque nascere già chiuso.
 */
export async function initialStatus(category: ActivityCategory) {
  return (
    (await prisma.taskStatus.findFirst({
      where: { category, isClosed: false },
      orderBy: { order: "asc" },
    })) ?? prisma.taskStatus.findFirst({ where: { category }, orderBy: { order: "asc" } })
  );
}

/**
 * Stato dei task assegnati della categoria, se l'admin ne ha contrassegnato uno
 * (es. "Assegnato" tra gli amministrativi). È lo stato in cui finisce un task che
 * riceve un assegnatario mentre è ancora nel primo stato: senza, resterebbe in
 * "Da assegnare" pur avendo già un responsabile.
 */
export async function assignedStatus(category: ActivityCategory) {
  return prisma.taskStatus.findFirst({ where: { category, isAssignedTarget: true } });
}

/**
 * Stato con cui nasce un task: quello dei task assegnati se un assegnatario c'è
 * già, altrimenti il primo stato aperto.
 */
export async function initialStatusFor(
  category: ActivityCategory,
  assigneeId: string | null | undefined,
) {
  if (assigneeId) {
    const assigned = await assignedStatus(category);
    if (assigned) return assigned;
  }
  return initialStatus(category);
}

/** Come initialStatus, ma fallisce con un messaggio utile se la lista è vuota. */
export async function requireInitialStatusId(category: ActivityCategory): Promise<string> {
  const status = await initialStatus(category);
  if (!status) {
    throw badRequest(
      "Nessuno stato configurato per la categoria {{category}}: creane uno dalla pagina Stati",
      { category },
    );
  }
  return status.id;
}

/** Verifica che lo stato esista e appartenga alla categoria del task. */
export async function assertStatusInCategory(statusId: string, category: ActivityCategory) {
  const status = await prisma.taskStatus.findUnique({ where: { id: statusId } });
  if (!status) throw badRequest("Stato non valido");
  if (status.category !== category) {
    throw badRequest('Lo stato "{{status}}" appartiene a un\'altra categoria di attività', {
      status: status.name,
    });
  }
  return status;
}

/**
 * Stato equivalente in un'altra categoria, usato quando cambia il tipo di attività
 * di un task e il suo stato non appartiene più alla lista giusta. La regola —
 * stesso nome, poi stessa posizione tra gli stati con la stessa apertura, un task
 * chiuso resta chiuso — vive in `equivalentStatusId` (packages/shared), la stessa
 * che il dialog di spostamento mostra prima di muovere: ciò che si vede è ciò che
 * poi succede.
 */
export async function remapStatusToCategory(
  currentStatusId: string,
  category: ActivityCategory,
): Promise<string> {
  const [current, all] = await Promise.all([
    prisma.taskStatus.findUnique({ where: { id: currentStatusId } }),
    prisma.taskStatus.findMany(),
  ]);
  const id = equivalentStatusId(current, all, category);
  if (!id)
    throw badRequest("Nessuno stato configurato per la categoria {{category}}", { category });
  return id;
}
