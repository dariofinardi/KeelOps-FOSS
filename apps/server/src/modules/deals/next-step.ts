import { primoPasso, type FiltroOfferteFerme } from "@kancrm/shared";
import type { Prisma } from "../../generated/prisma/client";
import { dayInRome, toDateOnly } from "../../lib/date";

/**
 * **Il prossimo passo di un'offerta, lato database** (17/09/2026).
 *
 * La regola — quale task è il passo, quando un'offerta è ferma — sta in
 * `packages/shared/src/deal-next-step.ts`. Qui c'è come la si chiede a Prisma:
 * i task aperti collegati, e il filtro «Ferme» scritto come `where`, perché
 * l'elenco è paginato sul server e un filtro applicato dopo sbaglierebbe pagine
 * e totali.
 */

/** Un task collegato che conta come passo: aperto e non nel cestino. */
export const taskApertoWhere = {
  deletedAt: null,
  status: { isClosed: false },
} satisfies Prisma.TaskWhereInput;

/** Quello che serve del task per mostrarlo come passo (l'elenco interno). */
export const passiInclude = {
  where: taskApertoWhere,
  select: {
    id: true,
    title: true,
    dueDate: true,
    assignee: { select: { name: true } },
    // il tipo serve al monitor vendite, che del passo vede di cosa si tratta
    activityType: { select: { name: true, color: true } },
  },
  orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
} satisfies Prisma.Task$dealTasksArgs;

/** Il passo, già scelto con la regola condivisa, nella forma della risposta. */
export function prossimoPassoDi(
  aperti: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    assignee: { name: string } | null;
  }>,
) {
  const passo = primoPasso(
    aperti.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: toDateOnly(task.dueDate),
      assigneeName: task.assignee?.name ?? null,
    })),
  );
  return passo;
}

/**
 * «Oggi» nel fuso aziendale, come mezzanotte UTC: è la forma delle date senza
 * ora nel database (CLAUDE.md), quindi «scaduto» è semplicemente `< oggi`.
 */
export function oggiAMezzanotte(now = new Date()): Date {
  return new Date(`${dayInRome(now)}T00:00:00.000Z`);
}

const offertaAperta = {
  dealStage: { isWon: false, isLost: false },
} satisfies Prisma.TaskWhereInput;

/**
 * Il filtro «Ferme» come `where`. Contiene degli `OR`: chi lo usa lo mette
 * **dentro un `AND`** (CLAUDE.md, «trappole già pagate»).
 *
 * «Il passo è scaduto» vuol dire che il primo task aperto per scadenza è
 * scaduto — e questo equivale a «almeno un task aperto è scaduto»: se uno lo
 * è, il più vicino lo è per forza.
 */
export function offerteFermeWhere(filtro: FiltroOfferteFerme, oggi: Date): Prisma.TaskWhereInput {
  const senzaPasso: Prisma.TaskWhereInput = { dealTasks: { none: taskApertoWhere } };
  const passoScaduto: Prisma.TaskWhereInput = {
    dealTasks: { some: { ...taskApertoWhere, dueDate: { lt: oggi } } },
  };
  const chiusuraPassata: Prisma.TaskWhereInput = { expectedCloseDate: { lt: oggi } };
  const perMotivo = { senzaPasso, passoScaduto, chiusuraPassata };
  return {
    AND: [
      offertaAperta,
      filtro === "tutte" ? { OR: [senzaPasso, passoScaduto, chiusuraPassata] } : perMotivo[filtro],
    ],
  };
}
