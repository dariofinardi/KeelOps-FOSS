import { MAX_HOURS_PER_DAY, roundHours } from "@kancrm/shared";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import type { User } from "../../generated/prisma/client";
import { assertTaskViewAccess } from "../tasks/routes";

/**
 * **Scrivere una cella del timesheet**, in un posto solo (29/09/2026).
 *
 * Stava dentro la rotta `PUT /api/timesheet/entry`. Ora le ore le scrive anche
 * un plugin — i rapportini di intervento, a fine giornata — e le regole sono le
 * stesse per tutti: mese chiuso, task visibile e non nel cestino né di una
 * bacheca, al massimo 24 ore al giorno. Scritte due volte, al primo ritocco una
 * delle due sarebbe rimasta indietro.
 */

export async function isMonthLocked(month: string): Promise<boolean> {
  const lock = await prisma.timesheetLock.findUnique({ where: { month } });
  return lock !== null;
}

export async function assertMonthOpen(month: string): Promise<void> {
  if (await isMonthLocked(month)) {
    throw badRequest("Il mese {{month}} è chiuso: le ore non sono più modificabili", { month });
  }
}

export interface TimeEntryInput {
  taskId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Già arrotondate; 0 elimina la registrazione. */
  hours: number;
  note?: string | null;
}

/** Scrive (o toglie, con zero ore) la cella di `user` su quel task e quel giorno. */
export async function upsertTimeEntry(
  user: User,
  input: TimeEntryInput,
): Promise<{ taskId: string; date: string; hours: number }> {
  const date = new Date(`${input.date}T00:00:00.000Z`);
  await assertMonthOpen(input.date.slice(0, 7));

  const task = await prisma.task.findUnique({ where: { id: input.taskId } });
  // Stessa regola della riga tenuta a mano (POST /rows): niente ore su task
  // nel cestino o di board — il perimetro li esclude ovunque, e senza questo
  // controllo una riga rimasta a video dopo un'eliminazione le accettava.
  if (!task || task.deletedAt || task.boardId) throw badRequest("Task non valido");
  // Imputazione su qualunque task visibile (non solo assegnato).
  await assertTaskViewAccess(user, task);

  const key = { userId_taskId_date: { userId: user.id, taskId: input.taskId, date } };
  if (input.hours === 0) {
    await prisma.timeEntry.deleteMany({
      where: { userId: user.id, taskId: input.taskId, date },
    });
    return { taskId: input.taskId, date: input.date, hours: 0 };
  }

  // Vincolo: massimo 24 ore per giorno per utente.
  const sameDay = await prisma.timeEntry.findMany({
    where: { userId: user.id, date, taskId: { not: input.taskId } },
  });
  const otherHours = sameDay.reduce((sum, entry) => sum + entry.hours, 0);
  if (otherHours + input.hours > MAX_HOURS_PER_DAY) {
    throw badRequest("Massimo 24 ore al giorno: ne hai già registrate {{hours}} il {{date}}", {
      hours: otherHours,
      date: input.date,
    });
  }

  await prisma.timeEntry.upsert({
    where: key,
    update: { hours: input.hours, note: input.note ?? null },
    create: {
      userId: user.id,
      taskId: input.taskId,
      date,
      hours: input.hours,
      note: input.note ?? null,
    },
  });
  return { taskId: input.taskId, date: input.date, hours: input.hours };
}

/**
 * **Aggiunge** ore a una cella (o ne toglie, con un numero negativo), senza
 * toccare quelle che la persona ci ha scritto a mano: è il modo in cui un
 * rapportino entra nel timesheet. Il risultato non scende sotto zero. La nota
 * già scritta resta; se non c'era, si usa quella proposta.
 */
export async function addToTimeEntry(
  user: User,
  input: { taskId: string; date: string; delta: number; note?: string | null },
): Promise<{ taskId: string; date: string; hours: number }> {
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const esistente = await prisma.timeEntry.findUnique({
    where: { userId_taskId_date: { userId: user.id, taskId: input.taskId, date } },
  });
  const hours = Math.max(0, roundHours((esistente?.hours ?? 0) + input.delta));
  return upsertTimeEntry(user, {
    taskId: input.taskId,
    date: input.date,
    hours,
    note: esistente?.note ?? input.note ?? null,
  });
}
