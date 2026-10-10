// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { TaskKind, type ActivityCategory } from "@kancrm/shared";
import { parseDateOnly, startOfTodayUTC } from "../../lib/date";
import { prisma, prismaRaw } from "../../db";
import { initialStatusFor, statusCategoryOfTask } from "../task-statuses/service";
import { buildRule } from "./rrule";


/**
 * Stato iniziale delle occorrenze: il primo stato aperto della categoria del tipo
 * di attività del template. Senza tipo vale la categoria ADMIN e non GENERAL: le
 * occorrenze sono task dello scadenzario, e devono comparire nella sua bacheca
 * ("Da assegnare"), non in quella dei task generici.
 */
async function initialStatusId(
  activityTypeId: string | null,
  assigneeId: string | null = null,
): Promise<string | null> {
  const first = await initialStatusFor(await occurrenceCategory(activityTypeId), assigneeId);
  return first?.id ?? null;
}

/** Stato iniziale delle occorrenze: quello scelto sul template, o il default di categoria. */
async function resolveInitialStatusId(template: {
  initialStatusId: string | null;
  activityTypeId: string | null;
  assigneeId?: string | null;
}): Promise<string | null> {
  if (template.initialStatusId) return template.initialStatusId;
  return initialStatusId(template.activityTypeId, template.assigneeId ?? null);
}

/** Categoria degli stati di un'occorrenza: è un task dello scadenzario. */
export async function occurrenceCategory(activityTypeId: string | null): Promise<ActivityCategory> {
  return statusCategoryOfTask({ activityTypeId, kind: TaskKind.ADMIN });
}

type TemplateWithAttachments = NonNullable<Awaited<ReturnType<typeof loadTemplateWithAttachments>>>;

function loadTemplateWithAttachments(templateId: string) {
  return prisma.recurrenceTemplate.findUnique({
    where: { id: templateId },
    include: { attachments: true },
  });
}

/**
 * Crea il task di una singola occorrenza, se non esiste già.
 * Il controllo usa il client raw: un'occorrenza spostata nel cestino conta come
 * esistente (eliminata resta eliminata, non va rigenerata).
 * Ritorna true se il task è stato creato.
 */
async function createOccurrenceIfMissing(
  template: TemplateWithAttachments,
  statusId: string,
  occurrence: Date,
): Promise<boolean> {
  const existing = await prismaRaw.task.findUnique({
    where: {
      recurrenceTemplateId_occurrenceDate: {
        recurrenceTemplateId: template.id,
        occurrenceDate: occurrence,
      },
    },
  });
  if (existing) return false;

  await prisma.task.create({
    data: {
      kind: TaskKind.ADMIN,
      title: template.title,
      description: template.description,
      statusId,
      creatorId: template.creatorId,
      assigneeId: template.assigneeId,
      supervisorId: template.supervisorId,
      activityTypeId: template.activityTypeId,
      dueDate: occurrence,
      // Riferimenti (non cambiano la visibilità): il task resta nello scadenzario
      // ma sa a quale offerta (o progetto, per i template storici) appartiene.
      relatedDealId: template.relatedDealId,
      relatedProjectId: template.projectId,
      recurrenceTemplateId: template.id,
      occurrenceDate: occurrence,
      attachments: {
        create: template.attachments.map((ta) => ({ attachmentId: ta.attachmentId })),
      },
      activities: { create: { userId: template.creatorId, action: "created" } },
    },
  });
  return true;
}

/**
 * Modello a **occorrenza singola**: ogni template attivo ha al più UN task vivo
 * (aperto, non nel cestino) alla volta. Non si pre-materializza una finestra di
 * date: il task avanza da solo alla scadenza successiva quando viene completato
 * (vedi planRecurrenceAdvance). Questa funzione fa solo il bootstrap — crea la
 * prossima occorrenza se non ne esiste già una viva. Idempotente.
 * Ritorna il numero di task creati (0 o 1).
 */
export async function materializeTemplate(templateId: string, now = new Date()): Promise<number> {
  const template = await loadTemplateWithAttachments(templateId);
  if (!template || !template.isActive) return 0;

  // Esiste già un'occorrenza viva? Allora non se ne crea un'altra.
  const live = await prismaRaw.task.count({
    where: { recurrenceTemplateId: templateId, deletedAt: null, status: { isClosed: false } },
  });
  if (live > 0) return 0;

  const statusId = await resolveInitialStatusId(template);
  if (!statusId) return 0; // nessuno stato configurato

  // Prossima data: dopo l'ultima occorrenza mai creata (anche chiusa o cestinata, così
  // non si rigenera una data già consumata), o la prima da oggi in poi per un template
  // nuovo. Le date passate non si materializzano.
  const last = await prismaRaw.task.findFirst({
    where: { recurrenceTemplateId: templateId },
    orderBy: { occurrenceDate: "desc" },
    select: { occurrenceDate: true },
  });
  const rule = buildRule(template.rrule, template.dtstart);
  const from = startOfTodayUTC(now);
  const next = last?.occurrenceDate
    ? rule.after(last.occurrenceDate, false)
    : rule.after(new Date(from.getTime() - 1), true);
  if (!next) return 0; // regola esaurita

  return (await createOccurrenceIfMissing(template, statusId, next)) ? 1 : 0;
}


/**
 * Data da cui calcolare il prossimo avanzamento.
 *
 * Di norma è l'occorrenza corrente. Se però il task è già stato avanzato oggi
 * **e la nuova scadenza è nel futuro**, si riparte dalla data che aveva prima di
 * quell'avanzamento (registrata nel log `recurrence_advanced`): completare due
 * volte nello stesso giorno — "mi sono sbagliata, l'ho riportata indietro e l'ho
 * rifatta" — non deve sommare i cicli, e una settimanale finiva a +2, +3 settimane.
 *
 * La condizione "nel futuro" è ciò che distingue il doppio clic dal **recupero
 * dell'arretrato**: una ricorrenza rimasta indietro avanza di un'occorrenza per
 * volta e resta scaduta, quindi un secondo "fatto" nella stessa giornata sta
 * completando un ciclo diverso e vero. Senza distinzione restava bloccata per
 * sempre sulla stessa data (caso reale: un canone mensile fermo al primo del
 * mese, che a ogni "Fatto" tornava lì).
 */
export async function advanceBaseDate(
  taskId: string,
  current: Date,
  now = new Date(),
): Promise<Date> {
  // Occorrenza scaduta o in scadenza oggi: c'è davvero qualcosa da completare.
  if (current.getTime() <= startOfTodayUTC(now).getTime()) return current;

  // L'**ultimo** avanzamento di oggi, non il primo: si annulla solo quello appena
  // fatto. Ripartire dal primo riavvolgerebbe l'intera giornata — dopo un recupero
  // di tre occorrenze arretrate, un clic di troppo avrebbe riportato la scadenza
  // al punto di partenza.
  const lastToday = await prisma.activityLog.findFirst({
    where: {
      taskId,
      action: "recurrence_advanced",
      createdAt: { gte: startOfTodayUTC(now) },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!lastToday?.payload) return current;
  try {
    const { from } = JSON.parse(lastToday.payload) as { from?: unknown };
    return parseDateOnly(from) ?? current;
  } catch {
    return current;
  }
}

/**
 * Completando un'occorrenza ricorrente NON si crea un nuovo task: lo stesso task
 * "ricicla" in avanti. Questa funzione calcola la prossima scadenza dopo `current`
 * e lo stato iniziale (che deve essere aperto) in cui il task deve tornare; il PATCH
 * applica poi data e stato allo stesso record.
 *
 * Ritorna null se il template non esiste/non è attivo, se la regola è esaurita
 * (RRULE con UNTIL/COUNT), o se lo stato iniziale non è aperto: in tutti questi casi
 * il task resta davvero chiuso.
 */
export async function planRecurrenceAdvance(
  templateId: string,
  current: Date | null | undefined,
): Promise<{ statusId: string; statusName: string; next: Date } | null> {
  if (!current) return null;
  const template = await prisma.recurrenceTemplate.findUnique({
    where: { id: templateId },
    select: {
      isActive: true,
      rrule: true,
      dtstart: true,
      initialStatusId: true,
      activityTypeId: true,
      assigneeId: true,
    },
  });
  if (!template || !template.isActive) return null;

  // current esclusa: la prossima scadenza è quella successiva a quella appena chiusa.
  const next = buildRule(template.rrule, template.dtstart).after(current, false);
  if (!next) return null; // regola esaurita → il task si chiude davvero

  const statusId = await resolveInitialStatusId(template);
  if (!statusId) return null;
  const status = await prisma.taskStatus.findUnique({
    where: { id: statusId },
    select: { name: true, isClosed: true },
  });
  // Lo stato iniziale deve essere aperto: riciclare in uno stato chiuso vorrebbe dire
  // "completare" all'infinito. Se non è aperto, fail-safe: si chiude davvero.
  if (!status || status.isClosed) return null;
  return { statusId, statusName: status.name, next };
}

/** Materializza tutti i template attivi (cron giornaliero e avvio server). */
export async function materializeAllTemplates(now = new Date()): Promise<number> {
  const templates = await prisma.recurrenceTemplate.findMany({ where: { isActive: true } });
  let created = 0;
  for (const template of templates) {
    created += await materializeTemplate(template.id, now);
  }
  return created;
}

/**
 * Occorrenze future "non ancora lavorate": scadenza da oggi in poi e ancora nello
 * stato iniziale (ordine più basso). Sono le uniche toccate da modifica/eliminazione
 * del template.
 */
export async function findFutureUntouchedOccurrences(templateId: string, now = new Date()) {
  const template = await prisma.recurrenceTemplate.findUnique({
    where: { id: templateId },
    select: { initialStatusId: true, activityTypeId: true, assigneeId: true },
  });
  if (!template) return [];
  const statusId = await resolveInitialStatusId(template);
  if (!statusId) return [];
  return prisma.task.findMany({
    where: {
      recurrenceTemplateId: templateId,
      occurrenceDate: { gte: startOfTodayUTC(now) },
      statusId,
    },
  });
}

/**
 * Applica al futuro le modifiche del template: se la pianificazione (rrule/dtstart)
 * è cambiata elimina e rigenera le occorrenze future non lavorate, altrimenti ne
 * aggiorna solo i campi (titolo, descrizione, assegnatario, supervisore).
 */
export async function syncTemplateOccurrences(
  templateId: string,
  options: { scheduleChanged: boolean },
  now = new Date(),
): Promise<void> {
  const template = await prisma.recurrenceTemplate.findUnique({ where: { id: templateId } });
  if (!template) return;

  const untouched = await findFutureUntouchedOccurrences(templateId, now);
  if (options.scheduleChanged || !template.isActive) {
    await prisma.task.deleteMany({ where: { id: { in: untouched.map((t) => t.id) } } });
  } else {
    await prisma.task.updateMany({
      where: { id: { in: untouched.map((t) => t.id) } },
      data: {
        title: template.title,
        description: template.description,
        assigneeId: template.assigneeId,
        supervisorId: template.supervisorId,
        relatedDealId: template.relatedDealId,
      },
    });
  }
  if (template.isActive) {
    await materializeTemplate(templateId, now);
  }
}
