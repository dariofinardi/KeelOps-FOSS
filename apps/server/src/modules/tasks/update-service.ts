// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  NotificationType,
  SEQUENCE_INCOMPLETE,
  SUBTASKS_OPEN,
  TaskKind,
  type TaskDetail,
  type UpdateTaskInput,
} from "@kancrm/shared";
import { prisma } from "../../db";
import { wipMessage, wipRecipients, wipStateFor } from "../task-statuses/wip";
import { badRequest, conflict, notFound } from "../../lib/http-errors";
import type { User } from "../../generated/prisma/client";
import { logActivity } from "./activity";
import { assertNoSequenceCycle, findOpenPredecessors } from "./sequence";
import { toTaskDetail } from "./serializers";
import { taskAccessContext } from "./permissions";
import { assertTaskEditAccess } from "./access";
import {
  activityTypeName,
  ensureActivityType,
  ensureMeeting,
  ensureUserExists,
  loadTaskDetail,
  notifyAssignment,
  parseDueDate,
  resolveMove,
  taskTitle,
  userName,
} from "./common";
import {
  assertStatusInCategory,
  assignedStatus,
  initialStatus,
  remapStatusToCategory,
  statusCategoryOfTask,
} from "../task-statuses/service";
import { advanceBaseDate, planRecurrenceAdvance } from "../recurrence/service";
import { notify, notifyMany } from "../notifications/service";
import { agganciTask } from "./lifecycle-hooks";

/** Risposta del PATCH: il dettaglio, più l'esito dell'avanzamento ricorrente. */
export type TaskUpdateResult = TaskDetail & { nextOccurrenceDate?: string | null };

/**
 * Attività amministrativa raggiunta: una tappa che per l'amministrazione è un
 * evento da fatturare (consegna beta, consegna in produzione, collaudo).
 *
 * A chi va detto: al **supervisore**, che è il modo in cui questa cosa si
 * configura — sul task di sviluppo si mette come referente la persona che poi
 * emette la fattura. Se manca, si ripiega sull'**amministrativo di riferimento**
 * dell'assegnatario (`User.billingAssignee`), lo stesso concetto che smista i
 * task delle offerte vinte. Senza né l'uno né l'altro non c'è nessuno da
 * avvisare: la spunta sullo stato resta un'etichetta, e il task si trova
 * comunque filtrando le attività amministrative.
 */
/**
 * "C'è una fattura da fare" ha senso solo se una fattura può esistere: il task
 * deve discendere da un'offerta — collegato direttamente (relatedDealId),
 * generato dall'offerta vinta (sourceDealId) o dentro un progetto nato da/legato
 * a un'offerta (Task.relatedProjectId sul deal). Senza questo filtro, bastava
 * marcare uno stato come tappa amministrativa per far partire "Da fatturare" su
 * QUALUNQUE task che ci passava — anche interni, senza niente da fatturare
 * (successo l'11/08/2026 con "Rilasciato" marcato per prova).
 */
async function isBillableTask(task: {
  relatedDealId: string | null;
  sourceDealId: string | null;
  projectId: string | null;
}): Promise<boolean> {
  if (task.relatedDealId || task.sourceDealId) return true;
  if (!task.projectId) return false;
  const dealForProject = await prisma.task.findFirst({
    where: { kind: TaskKind.DEAL, relatedProjectId: task.projectId, deletedAt: null },
    select: { id: true },
  });
  return dealForProject !== null;
}

async function notifyBillingMilestone(
  task: {
    id: string;
    title: string;
    kind: string;
    supervisorId: string | null;
    assigneeId: string | null;
    relatedDealId: string | null;
    sourceDealId: string | null;
    projectId: string | null;
  },
  statusName: string,
  actor: User,
): Promise<void> {
  if (!(await isBillableTask(task))) return;
  let recipientId = task.supervisorId;
  if (!recipientId && task.assigneeId) {
    const assignee = await prisma.user.findUnique({
      where: { id: task.assigneeId },
      select: { billingAssigneeId: true },
    });
    recipientId = assignee?.billingAssigneeId ?? null;
  }
  if (!recipientId) return;
  await notify(recipientId, actor.id, NotificationType.BILLING_MILESTONE, {
    message: (t) =>
      t('Da fatturare: "{{title}}" è passato a "{{status}}" ({{actor}})', {
        title: task.title,
        status: statusName,
        actor: actor.name,
      }),
    taskId: task.id,
    taskKind: task.kind as TaskKind,
  });
}

/**
 * Limite WIP superato: **solo nel momento in cui si supera**.
 *
 * `count === limit + 1` è il passaggio della soglia. Avvisare a ogni
 * spostamento successivo, finché si resta sopra, trasformerebbe un avviso utile
 * in un rumore che si impara a ignorare — e chi sposta il decimo task lo sa già
 * che sono troppi. Va ai manager del progetto, non a chi ha spostato: a lui il
 * triangolo giallo sulla colonna lo dice subito, e la regola di casa è che le
 * notifiche non tornano a chi ha fatto la modifica.
 *
 * Fuori dalla transazione, come le altre: dentro, il conteggio leggerebbe uno
 * stato non ancora scritto per gli altri.
 */
async function notifyWipLimit(taskId: string, projectId: string, actor: User): Promise<void> {
  // Lo stato si rilegge: `existing` è il task **prima** dello spostamento, e la
  // ricorrenza può averlo portato in uno stato diverso da quello chiesto.
  const current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { statusId: true, assigneeId: true },
  });
  // Senza assegnatario non c'è un "chi": un task in coda da prendere in carico
  // non è il lavoro in corso di qualcuno.
  if (!current?.statusId || !current.assigneeId) return;
  const statusId = current.statusId;
  const state = await wipStateFor(projectId, statusId, current.assigneeId);
  if (!state || state.count !== state.limit + 1) return;
  const [project, status, person] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    prisma.taskStatus.findUnique({ where: { id: statusId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: current.assigneeId }, select: { name: true } }),
  ]);
  if (!project || !status || !person) return;
  const breach = {
    projectId,
    projectName: project.name,
    statusId,
    statusName: status.name,
    userId: current.assigneeId,
    userName: person.name,
    count: state.count,
    limit: state.limit,
  };
  for (const userId of await wipRecipients(breach)) {
    await notify(userId, actor.id, NotificationType.WIP_LIMIT, {
      message: (t) => wipMessage(t, breach),
    });
  }
}

/**
 * Aggiornamento di un task: l'operazione più delicata dell'app, tenuta fuori dal
 * router e organizzata per fasi.
 *
 *  1. accesso e spostamento di contesto (progetto/offerta);
 *  2. validazione dei riferimenti (utenti, tipo, riunione, propedeutico);
 *  3. risoluzione dello stato: rimappatura di categoria, auto-presa in carico,
 *     guardie su sequenza e subtask, avanzamento in place delle ricorrenze;
 *  4. changelog con i nomi (non gli id: la cronaca resta leggibile);
 *  5. transazione di scrittura + notifiche (spostamento, assegnazione, supervisore).
 */
/**
 * **I task che si prendono in carico da sé**: gli adempimenti e il lavoro di
 * progetto (anche quello nato da un ticket). Le offerte hanno un proprietario
 * scelto apposta, e le richieste storiche passano dal desk.
 */
function siPrendeInCarico(kind: string): boolean {
  return kind === TaskKind.ADMIN || kind === TaskKind.PROJECT;
}

export async function applyTaskUpdate(
  user: User,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskUpdateResult> {
  // --- 1. Accesso e contesto -------------------------------------------------
  const existing = await prisma.task.findUnique({ where: { id }, include: { status: true } });
  if (!existing) throw notFound("Task non trovato");
  await assertTaskEditAccess(user, existing);
  // I moduli dell'edizione possono rifiutare (la presa in carico dei ticket).
  // Il rifiuto al portale sui ticket stava più sotto, dopo `resolveMove`: il
  // portale non arriva mai fin qui (`assertTaskEditAccess` lo ferma prima).
  for (const aggancio of agganciTask()) await aggancio.primaDiModificare?.(existing, user);

  // Cambio di contesto: progetto e collegamento all'offerta sono esclusivi
  // (un task appartiene a un progetto oppure è collegato a un'offerta).
  const movedKind = await resolveMove(user, existing, input);
  const newProjectId =
    input.projectId !== undefined ? input.projectId : (existing.projectId ?? null);
  const newRelatedDealId = newProjectId
    ? null
    : input.relatedDealId !== undefined
      ? input.relatedDealId
      : existing.relatedDealId;

  // --- 2. Validazione dei riferimenti ----------------------------------------
  if (input.assigneeId) await ensureUserExists(input.assigneeId, "Assegnatario");
  if (input.supervisorId) await ensureUserExists(input.supervisorId, "Supervisore");
  if (input.activityTypeId) await ensureActivityType(input.activityTypeId);
  if (input.meetingId !== undefined) {
    if (input.meetingId === id) throw badRequest("Un incontro non può riferirsi a sé stesso");
    await ensureMeeting(input.meetingId);
  }
  if (input.predecessorId) {
    const predecessor = await prisma.task.findUnique({ where: { id: input.predecessorId } });
    if (!predecessor) throw badRequest("Task propedeutico non valido");
    await assertNoSequenceCycle(id, input.predecessorId);
  }

  // --- 3. Risoluzione dello stato ---------------------------------------------
  // Auto-presa in carico: il primo che cambia stato o modifica un task ADMIN o di
  // progetto non ancora assegnato ne diventa l'assegnatario (se non lo sta già
  // assegnando esplicitamente).
  const autoAssign =
    siPrendeInCarico(existing.kind) &&
    existing.assigneeId === null &&
    input.assigneeId === undefined;

  // Cambiare tipo di attività può cambiare la categoria e quindi la lista degli
  // stati: se quello attuale non ne fa più parte si passa al corrispondente
  // (stesso nome, o stessa posizione tra gli aperti/chiusi). Un task chiuso
  // resta chiuso.
  const newCategory = await statusCategoryOfTask({
    activityTypeId:
      input.activityTypeId !== undefined ? input.activityTypeId : existing.activityTypeId,
    kind: movedKind ?? existing.kind,
  });
  let remappedStatusId: string | undefined;
  if (input.statusId === undefined && existing.status!.category !== newCategory) {
    remappedStatusId = await remapStatusToCategory(existing.statusId!, newCategory);
  }

  // Primo assegnatario su un task ancora nel primo stato: passa allo stato dei
  // task assegnati, se la categoria ne ha uno. Solo dal primo stato, altrimenti
  // assegnare qualcuno a un task "In esecuzione" lo riporterebbe indietro.
  if (input.statusId === undefined && !existing.assigneeId && input.assigneeId) {
    const first = await initialStatus(newCategory);
    if (first?.id === existing.statusId) {
      const assigned = await assignedStatus(newCategory);
      if (assigned && assigned.id !== existing.statusId) remappedStatusId = assigned.id;
    }
  }

  let closedAt: Date | null | undefined;
  let statusChange: { from: string; to: string } | undefined;
  let reachedBillingMilestone = false;
  // Avanzamento "in place" di un'occorrenza ricorrente completata (vedi sotto).
  let recurrenceAdvance: { statusId: string; statusName: string; next: Date } | undefined;
  // Occorrenza da cui si è calcolato l'avanzamento: finisce nel log, che a sua
  // volta è la memoria usata per annullare un doppio "fatto" (vedi advanceBaseDate).
  let advanceFrom: Date | null | undefined;
  if (input.statusId && input.statusId !== existing.statusId) {
    const newStatus = await assertStatusInCategory(input.statusId, newCategory);

    // Sequenza non bloccante: procedere fuori ordine richiede conferma esplicita.
    if (!input.confirmSequence) {
      const openPredecessors = await findOpenPredecessors(id);
      if (openPredecessors.length > 0) {
        const list = openPredecessors.map((t) => `"${t}"`).join(", ");
        throw conflict(
          openPredecessors.length === 1
            ? `Il task propedeutico ${list} non è ancora completato.`
            : `I task propedeutici ${list} non sono ancora completati.`,
          SEQUENCE_INCOMPLETE,
        );
      }
    }

    // Regola subtask: il padre è completo solo quando tutti i subtask sono chiusi.
    if (newStatus.isClosed && !input.confirmSubtasks) {
      const openSubtasks = await prisma.task.findMany({
        where: { parentTaskId: id, status: { isClosed: false } },
        select: { title: true },
      });
      if (openSubtasks.length > 0) {
        const list = openSubtasks.map((t) => `"${t.title}"`).join(", ");
        throw conflict(
          openSubtasks.length === 1
            ? `Il subtask ${list} è ancora aperto.`
            : `${openSubtasks.length} subtask sono ancora aperti: ${list}.`,
          SUBTASKS_OPEN,
        );
      }
    }

    statusChange = { from: existing.status!.name, to: newStatus.name };
    // Tappa da fatturare raggiunta ORA: solo entrando (se ci era già, nessuno va
    // avvisato due volte perché qualcuno ha rinominato o rimesso lo stato).
    reachedBillingMilestone = newStatus.isBillingMilestone && !existing.status!.isBillingMilestone;
    closedAt = newStatus.isClosed ? new Date() : null;

    // Ricorrente + stato chiuso = "completa il ciclo": invece di chiudere, lo stesso
    // task avanza alla prossima scadenza nel suo stato iniziale (aperto). Se la regola
    // è esaurita o l'iniziale non è aperto, planRecurrenceAdvance ritorna null → chiude.
    // Uno stato chiuso con stopsRecurrence (es. "Annullato") interrompe la serie: il
    // task resta lì senza avanzare, finché l'utente non lo sposta a mano.
    if (newStatus.isClosed && !newStatus.stopsRecurrence && existing.recurrenceTemplateId) {
      // La base non è sempre l'occorrenza corrente: se il task è già stato avanzato
      // oggi si riparte dalla data pre-avanzamento, così ricompletarlo nella stessa
      // giornata (errore + rifacimento) non somma i cicli. Vedi advanceBaseDate.
      const currentOccurrence = existing.occurrenceDate ?? existing.dueDate;
      advanceFrom = currentOccurrence
        ? await advanceBaseDate(id, currentOccurrence)
        : currentOccurrence;
      const advance = await planRecurrenceAdvance(existing.recurrenceTemplateId, advanceFrom);
      if (advance) {
        recurrenceAdvance = advance;
        closedAt = null; // non si chiude: si ricicla
        // Il log dello stato riflette l'atterraggio nell'iniziale, non "Completato".
        statusChange = { from: existing.status!.name, to: advance.statusName };
      }
    }
  }

  // Stato effettivamente applicato: l'avanzamento ricorrente ha la precedenza sullo
  // stato chiuso richiesto dall'utente (che diventa il segnale "completa il ciclo").
  const appliedStatusId = recurrenceAdvance
    ? recurrenceAdvance.statusId
    : input.statusId !== undefined
      ? input.statusId
      : (remappedStatusId ?? undefined);

  // --- 4. Changelog ------------------------------------------------------------
  // Una voce per tipo di modifica, con i NOMI e non gli id. Il log è una cronaca
  // storica: se poi l'utente viene rinominato o eliminato, la riga deve continuare
  // a dire chi era davvero l'assegnatario quel giorno. La descrizione resta fuori
  // (troppo verbosa per una timeline).
  const entries: Array<{ action: string; payload: { from: unknown; to: unknown } }> = [];
  if (input.title !== undefined && input.title !== existing.title) {
    entries.push({ action: "renamed", payload: { from: existing.title, to: input.title } });
  }
  const dueDate = parseDueDate(input.dueDate);
  const newTime = dueDate === null ? null : (input.dueTime ?? existing.dueTime);
  const dueChanged =
    (dueDate !== undefined && dueDate?.getTime() !== existing.dueDate?.getTime()) ||
    (input.dueTime !== undefined && (input.dueTime ?? null) !== existing.dueTime);
  if (dueChanged) {
    const label = (day: Date | null | undefined, time: string | null) =>
      day ? `${day.toISOString().slice(0, 10)}${time ? ` ${time}` : ""}` : null;
    entries.push({
      action: "due_changed",
      payload: {
        from: label(existing.dueDate, existing.dueTime),
        to: label(dueDate === undefined ? existing.dueDate : dueDate, newTime ?? null),
      },
    });
  }
  const newAssigneeId =
    input.assigneeId !== undefined ? input.assigneeId : autoAssign ? user.id : undefined;
  if (newAssigneeId !== undefined && newAssigneeId !== existing.assigneeId) {
    entries.push({
      action: "assignee_changed",
      payload: {
        from: await userName(existing.assigneeId),
        to: await userName(newAssigneeId),
      },
    });
  }
  if (input.supervisorId !== undefined && input.supervisorId !== existing.supervisorId) {
    entries.push({
      action: "supervisor_changed",
      payload: {
        from: await userName(existing.supervisorId),
        to: await userName(input.supervisorId),
      },
    });
  }
  if (input.activityTypeId !== undefined && input.activityTypeId !== existing.activityTypeId) {
    entries.push({
      action: "activity_type_changed",
      payload: {
        from: await activityTypeName(existing.activityTypeId),
        to: await activityTypeName(input.activityTypeId),
      },
    });
  }
  if (input.predecessorId !== undefined && input.predecessorId !== existing.predecessorId) {
    entries.push({
      action: "predecessor_changed",
      payload: {
        from: await taskTitle(existing.predecessorId),
        to: await taskTitle(input.predecessorId),
      },
    });
  }
  if (recurrenceAdvance) {
    const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
    entries.push({
      action: "recurrence_advanced",
      payload: {
        // La data realmente usata come base, non quella che il task mostrava:
        // se questo "fatto" ne annulla uno precedente della stessa giornata, il
        // log deve raccontare l'avanzamento vero — è da qui che si ricostruisce
        // la base del prossimo.
        from: iso(advanceFrom),
        to: iso(recurrenceAdvance.next),
      },
    });
  }

  // Cliente diretto: vale per i task normali; le offerte lo gestiscono dal
  // proprio pannello, e passare di qui creerebbe due strade per lo stesso campo.
  let companyChange: { from: string | null; to: string | null } | undefined;
  if (input.companyId !== undefined) {
    if (existing.kind === TaskKind.DEAL) {
      throw badRequest("Il cliente di un'offerta si cambia dal pannello dell'offerta");
    }
    const next = input.companyId
      ? await prisma.company.findUnique({ where: { id: input.companyId } })
      : null;
    if (input.companyId && !next) throw badRequest("Azienda non trovata");
    if ((next?.id ?? null) !== existing.companyId) {
      const prev = existing.companyId
        ? await prisma.company.findUnique({ where: { id: existing.companyId } })
        : null;
      companyChange = { from: prev?.name ?? null, to: next?.name ?? null };
      entries.push({ action: "company_changed", payload: companyChange });
    }
  }

  // Su un task ricorrente la data mostrata È l'occorrenza: chi la cambia a mano
  // sta spostando il posto del task nella serie, e il segnaposto interno deve
  // seguirla. Lasciarlo dov'era significa che il prossimo "Fatto" riparte da una
  // data che nessuno vede più — caso reale: completamento per sbaglio, data
  // rimessa indietro a mano, e il rinnovo successivo che salta un mese perché
  // calcolato dal segnaposto rimasto avanti.
  const manualOccurrenceSync =
    !recurrenceAdvance && existing.recurrenceTemplateId && dueDate ? dueDate : undefined;

  // --- 5. Scrittura e notifiche --------------------------------------------------
  await prisma.$transaction(async (tx) => {
    // Ricicla in place: libera la chiave unica (templateId, data) da un'eventuale
    // occorrenza già presente a quella scadenza prima di spostarci questo task.
    const nextOccurrence = recurrenceAdvance?.next ?? manualOccurrenceSync;
    if (nextOccurrence) {
      await tx.task.deleteMany({
        where: {
          recurrenceTemplateId: existing.recurrenceTemplateId!,
          occurrenceDate: nextOccurrence,
          id: { not: id },
        },
      });
    }
    await tx.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(appliedStatusId !== undefined ? { statusId: appliedStatusId } : {}),
        ...(input.activityTypeId !== undefined ? { activityTypeId: input.activityTypeId } : {}),
        ...(input.assigneeId !== undefined
          ? { assigneeId: input.assigneeId }
          : autoAssign
            ? { assigneeId: user.id }
            : {}),
        ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
        ...(input.predecessorId !== undefined ? { predecessorId: input.predecessorId } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        // Senza data non c'è orario: togliendo la scadenza si toglie anche l'ora.
        ...(dueDate === null
          ? { dueTime: null }
          : input.dueTime !== undefined
            ? { dueTime: input.dueTime ?? null }
            : {}),
        ...(input.meetingId !== undefined ? { meetingId: input.meetingId } : {}),
        ...(input.participants !== undefined ? { participants: input.participants } : {}),
        ...(movedKind
          ? {
              kind: movedKind,
              projectId: newProjectId,
              relatedDealId: newRelatedDealId ?? null,
            }
          : {}),
        ...(closedAt !== undefined ? { closedAt } : {}),
        ...(companyChange !== undefined ? { companyId: input.companyId || null } : {}),
        ...(manualOccurrenceSync ? { occurrenceDate: manualOccurrenceSync } : {}),
        // Avanzamento ricorrente: sposta scadenza e occorrenza alla data successiva.
        ...(recurrenceAdvance
          ? { occurrenceDate: recurrenceAdvance.next, dueDate: recurrenceAdvance.next }
          : {}),
      },
    });
    if (statusChange) {
      await logActivity(tx, id, user.id, "status_changed", statusChange);
    }
    // La tappa da fatturare lascia il segno nello storico, non solo una notifica
    // nella campanella di qualcun altro: chi apre il task settimane dopo deve
    // poter vedere quando è scattata e chi l'ha fatta scattare — altrimenti
    // l'unica traccia è un messaggio letto e sparito.
    if (reachedBillingMilestone && statusChange) {
      await logActivity(tx, id, user.id, "billing_milestone", { status: statusChange.to });
    }
    for (const entry of entries) {
      await logActivity(tx, id, user.id, entry.action, entry.payload);
    }
    // Tag: se forniti, sostituiscono l'insieme corrente.
    if (input.tagIds !== undefined) {
      await tx.taskTag.deleteMany({ where: { taskId: id } });
      if (input.tagIds.length > 0) {
        await tx.taskTag.createMany({
          data: input.tagIds.map((tagId) => ({ taskId: id, tagId })),
        });
      }
    }
  });

  // Lo spostamento cambia chi vede il task: va detto a chi ci lavora.
  if (movedKind) {
    const label = async (projectId: string | null, dealId: string | null) => {
      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        return `Progetto: ${project?.name ?? "—"}`;
      }
      if (dealId) {
        const deal = await prisma.task.findUnique({ where: { id: dealId } });
        return `Scadenzario · offerta "${deal?.title ?? "—"}"`;
      }
      return "Scadenzario";
    };
    const from = await label(existing.projectId, existing.relatedDealId);
    const to = await label(newProjectId, newRelatedDealId ?? null);
    if (from !== to) {
      await prisma.$transaction(async (tx) => {
        await logActivity(tx, id, user.id, "moved", { from, to });
      });
      await notifyMany(
        [existing.assigneeId, existing.supervisorId],
        user.id,
        NotificationType.TASK_ASSIGNED,
        {
          message: (t) =>
            t('"{{title}}" è stato spostato: {{from}} → {{to}}', {
              title: existing.title,
              from,
              to,
            }),
          taskId: id,
          // Lo spostamento può cambiare la natura del task (progetto ⇄ scadenzario):
          // vale quella nuova, che è dove lo si troverà cliccando.
          taskKind: (movedKind ?? existing.kind) as TaskKind,
        },
      );
    }
  }

  // Notifiche: nuova assegnazione + cambio stato al supervisore.
  if (input.assigneeId && input.assigneeId !== existing.assigneeId) {
    await notifyAssignment(existing, input.assigneeId, user);
  }
  if (statusChange && existing.supervisorId) {
    await notify(existing.supervisorId, user.id, NotificationType.SUPERVISED_STATUS_CHANGED, {
      message: (t) =>
        t('"{{title}}": stato {{from}} → {{to}} ({{actor}})', {
          title: existing.title,
          from: statusChange.from,
          to: statusChange.to,
          actor: user.name,
        }),
      taskId: id,
      taskKind: existing.kind as TaskKind,
    });
  }
  if (reachedBillingMilestone) {
    await notifyBillingMilestone(existing, statusChange!.to, user);
  }
  // Il limite si supera in due modi: spostando un task in quello stato, o
  // **assegnando** a qualcuno un task che già ci sta. Guardare solo il cambio
  // di stato lasciava passare il secondo in silenzio (18/08/2026).
  const assigneeChanged = Boolean(input.assigneeId) && input.assigneeId !== existing.assigneeId;
  if ((statusChange || assigneeChanged) && existing.projectId) {
    await notifyWipLimit(id, existing.projectId, user);
  }
  if (statusChange) {
    for (const aggancio of agganciTask()) {
      await aggancio.dopoCambioStato?.({ existing, user, statusChange });
    }
  }

  // Occorrenza ricorrente completata: lo stesso task è già avanzato in place alla
  // scadenza successiva (nessun nuovo task). La UI usa nextOccurrenceDate per il toast.
  const detail = toTaskDetail(await loadTaskDetail(id), await taskAccessContext(user));
  if (recurrenceAdvance) {
    return { ...detail, nextOccurrenceDate: recurrenceAdvance.next.toISOString().slice(0, 10) };
  }
  // Ricorrente chiusa senza avanzamento = regola esaurita: lo si dice al client
  // (nextOccurrenceDate: null → toast "niente più scadenze").
  if (existing.recurrenceTemplateId && closedAt) {
    return { ...detail, nextOccurrenceDate: null };
  }
  return detail;
}
