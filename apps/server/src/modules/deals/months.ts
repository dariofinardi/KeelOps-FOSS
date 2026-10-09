import { dealMonthKey, monthRangeUTC, SENZA_DATA } from "@kancrm/shared";
import type { Prisma } from "../../generated/prisma/client";
import { toDateOnly } from "../../lib/date";

/**
 * **Il filtro per mese di chiusura, lato database** (03/10/2026). La regola —
 * di che mese è un'offerta — sta in `packages/shared/src/deal-months.ts`: qui
 * c'è come la si chiede a Prisma, perché l'elenco è paginato sul server e un
 * filtro applicato dopo sbaglierebbe pagine e totali.
 *
 * Un mese scelto vuol dire: chiusa in quel mese, oppure non chiusa e prevista
 * in quel mese. `senza-data`: né chiusa né prevista. Contiene degli `OR`: chi
 * lo usa lo mette **dentro un `AND`** (CLAUDE.md, «trappole già pagate»).
 */
export function dealMonthsWhere(months: readonly string[]): Prisma.TaskWhereInput | null {
  if (months.length === 0) return null;
  const alternative: Prisma.TaskWhereInput[] = months.map((key) => {
    if (key === SENZA_DATA) return { closedAt: null, expectedCloseDate: null };
    const { da, a } = monthRangeUTC(key);
    return {
      OR: [
        { closedAt: { gte: da, lt: a } },
        { closedAt: null, expectedCloseDate: { gte: da, lt: a } },
      ],
    };
  });
  return { OR: alternative };
}

/** I mesi presenti in un insieme di offerte, in ordine, con `senza-data` in fondo. */
export function dealMonthFacet(
  rows: Array<{ closedAt: Date | null; expectedCloseDate: Date | null }>,
): Array<{ key: string; count: number }> {
  const conta = new Map<string, number>();
  for (const row of rows) {
    const key = dealMonthKey({
      closedAt: toDateOnly(row.closedAt),
      expectedCloseDate: toDateOnly(row.expectedCloseDate),
    });
    conta.set(key, (conta.get(key) ?? 0) + 1);
  }
  return [...conta.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((x, y) =>
      x.key === SENZA_DATA ? 1 : y.key === SENZA_DATA ? -1 : x.key.localeCompare(y.key),
    );
}
