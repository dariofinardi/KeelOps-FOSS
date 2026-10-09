import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import { initialStatusFor, requireInitialStatusId } from "../task-statuses/service";
import { logActivity } from "../tasks/activity";
import { notifyAssignment } from "../tasks/common";
import type { User } from "../../generated/prisma/client";
import { calendarFeedsEnabled } from "./settings";

/**
 * "Chiedi agli amministratori di poter usare i calendari."
 *
 * Una funzione spenta è una porta chiusa, e davanti a una porta chiusa la cosa
 * peggiore è un cartello che non dice a chi bussare. Questo bottone bussa: apre
 * **un task per ogni amministratore**, con scadenza a due giorni, e mette chi ha
 * chiesto come referente — così sa com'è finita senza dover ridomandare.
 *
 * È **idempotente**: chi preme cinque volte perché non succede niente non deve
 * generare quindici task. Finché la richiesta è aperta, ripremere non aggiunge
 * niente.
 */
const TITLE_PREFIX = "Attivare i calendari esterni per";

/** Entro quando: due giorni. Non è un'urgenza, ma nemmeno una cosa da mese prossimo. */
const DUE_DAYS = 2;

function titleFor(user: User): string {
  return `${TITLE_PREFIX} ${user.name}`;
}

/** C'è già una richiesta aperta di questa persona? */
export async function pendingCalendarRequest(user: User): Promise<boolean> {
  const open = await prisma.task.findFirst({
    where: {
      kind: TaskKind.ADMIN,
      title: titleFor(user),
      supervisorId: user.id,
      status: { isClosed: false },
      deletedAt: null,
    },
  });
  return open !== null;
}

/**
 * Crea la richiesta. Restituisce quanti amministratori sono stati avvisati (0 se
 * la richiesta era già aperta).
 */
export async function requestCalendarAccess(user: User, now = new Date()): Promise<number> {
  if (await calendarFeedsEnabled()) {
    throw badRequest("I calendari sono già attivi: il link si genera dal tuo Profilo");
  }
  if (user.role === UserRole.PORTAL || user.role === UserRole.SALES_MONITOR) {
    throw badRequest("Funzione riservata agli utenti interni");
  }
  if (await pendingCalendarRequest(user)) return 0;

  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, isActive: true, isSystem: false },
  });
  if (admins.length === 0) throw badRequest("Non risulta nessun amministratore da avvisare");

  const dueDate = new Date(now);
  dueDate.setUTCDate(dueDate.getUTCDate() + DUE_DAYS);
  dueDate.setUTCHours(0, 0, 0, 0);

  const description =
    `${user.name} chiede di poter aprire le proprie bacheche da Google Calendar, ` +
    `Outlook o dal telefono.\n\n` +
    `Si abilita dalla pagina Email e Calendari, spunta «Calendari sottoscrivibili». ` +
    `Da lì ognuno genera i propri link dal Profilo — sono in sola lettura, uno per ` +
    `bacheca e revocabili singolarmente.`;

  for (const admin of admins) {
    const status =
      (await initialStatusFor(ActivityCategory.ADMIN, admin.id))?.id ??
      (await requireInitialStatusId(ActivityCategory.ADMIN));
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          kind: TaskKind.ADMIN,
          title: titleFor(user),
          description,
          statusId: status,
          creatorId: user.id,
          assigneeId: admin.id,
          // Chi ha chiesto resta referente: è il modo per sapere com'è finita.
          supervisorId: user.id,
          dueDate,
        },
      });
      await logActivity(tx, created.id, user.id, "created");
      return created;
    });
    await notifyAssignment(task, admin.id, user);
  }
  return admins.length;
}
