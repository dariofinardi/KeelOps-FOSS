// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/*
 * Helpers of the timesheet grid, shared by the core routes (hours/routes.ts)
 * and the commercial ones (timesheet/routes.ts). Moved verbatim from
 * timesheet/routes.ts on 08/10/2026.
 */
import {
  ProjectRole,
  TaskKind,
  UserRole,
  monthString,
  periodString,
  periodKind,
  periodMonths,
  periodRange,
  type TimesheetTaskRef,
} from "@kancrm/shared";
import { z } from "zod";
import { prisma } from "../../db";
import { badRequest } from "../../lib/http-errors";
import type { Prisma, User } from "../../generated/prisma/client";
import { assertMonthOpen } from "./entry-service";

export function monthRange(month: string): { from: Date; to: Date } {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

/** L'intervallo del periodo (mese o settimana) come date UTC, fine esclusa. */
export function rangeOf(period: string): { from: Date; to: Date } {
  const { from, toExclusive } = periodRange(period);
  return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${toExclusive}T00:00:00.000Z`) };
}

/**
 * Le righe tenute a mano che appartengono al periodo guardato.
 *
 * Guardando un **mese** si vedono anche quelle aggiunte settimana per settimana:
 * sono righe di quel mese. Guardando una **settimana** si vedono **solo le
 * sue**: le righe mensili erano venticinque contro tre task davvero lavorati in
 * quei giorni, e la vista stretta tornava larga come prima (12/08/2026). Una
 * riga appartiene al periodo in cui la si è aggiunta; serve anche nella
 * settimana, la si aggiunge lì — è un gesto, non una perdita.
 */
export function pinPeriodWhere(period: string): Prisma.TimesheetPinWhereInput {
  if (periodKind(period) === "month") {
    return { OR: [{ period }, { period: { startsWith: `${period}-` } }] };
  }
  return { period };
}

/** Un periodo è chiuso se lo è ANCHE UNO dei mesi che tocca (settimane a cavallo). */
export async function isPeriodLocked(period: string): Promise<boolean> {
  const locks = await prisma.timesheetLock.findMany({
    where: { month: { in: periodMonths(period) } },
  });
  return locks.length > 0;
}

/**
 * Il periodo di una richiesta. `month` resta accettato accanto a `period`:
 * durante un rilascio i browser già aperti hanno in mano il pacchetto vecchio e
 * continuano a chiedere col nome di prima — un errore a metà deploy per chi sta
 * scrivendo le ore non se lo merita nessuno.
 */
export const periodInput = z.object({
  period: periodString.optional(),
  month: monthString.optional(),
});

export function periodOf(input: { period?: string; month?: string }): string {
  const period = input.period ?? input.month;
  if (!period) throw badRequest("Periodo mancante");
  return period;
}

/** Come assertMonthOpen, ma per un periodo: controlla tutti i mesi toccati. */
export async function assertPeriodOpen(period: string): Promise<void> {
  for (const month of periodMonths(period)) await assertMonthOpen(month);
}

/** Tutto ciò che serve a una riga della griglia: contesto, cliente e contatori. */
export const taskRefInclude = {
  project: { include: { company: true } },
  company: true,
  // Lo stato serve solo a dire "chiuso" in tendina: i task chiusi si possono
  // scegliere (le ore si registrano dopo), ma è giusto vedere che lo sono.
  status: { select: { isClosed: true } },
  _count: { select: { attachments: true, comments: true } },
} satisfies Prisma.TaskInclude;

export type TaskForRef = Prisma.TaskGetPayload<{ include: typeof taskRefInclude }>;

/**
 * Dove vive il task: il progetto, oppure il modulo. Lo usano anche i riepiloghi e
 * l'esportazione, che del resto della riga non hanno bisogno.
 */
export function contextLabel(task: { kind: string; project?: { name: string } | null }): string {
  return task.kind === TaskKind.PROJECT
    ? (task.project?.name ?? "Progetto")
    : task.kind === TaskKind.DEAL
      ? "Offerte"
      : "Scadenzario";
}

export function toTaskRef(task: TaskForRef): TimesheetTaskRef {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    context: contextLabel(task),
    // Il cliente sta sul task o, più spesso, sul progetto a cui appartiene.
    company: task.company?.name ?? task.project?.company?.name ?? null,
    attachmentCount: task._count.attachments,
    commentCount: task._count.comments,
    isClosed: task.status?.isClosed ?? false,
    // Le due forme di richiesta: quelle storiche (kind TICKET) e i task di
    // progetto nati da un ticket. Vedi tickets/access.isTicketRecord.
    fromTicket: task.kind === TaskKind.TICKET || task.createdViaTicket,
  };
}

/** Filtro delle registrazioni visibili nei riepiloghi (vedi plan.md M6). */
export function accessibleEntriesWhere(user: User): Prisma.TimeEntryWhereInput {
  // Admin e chi ha il permesso "vede tutti i timesheet": nessun filtro.
  if (user.role === UserRole.ADMIN || user.canViewAllTimesheets) return {};
  return {
    OR: [
      { userId: user.id },
      { task: { supervisorId: user.id } },
      {
        task: {
          project: {
            members: { some: { userId: user.id, role: ProjectRole.MANAGER } },
          },
        },
      },
    ],
  };
}
