import { z } from "zod";

/**
 * **Il quadro di produttività di un mese**: ore vere contro ore dovute, e dove
 * il tempo è finito.
 *
 * Serve al controllo di gestione e alla contabilità analitica, quindi porta i
 * numeri già pronti — quote comprese — perché due schermate che rifanno lo
 * stesso conto in due modi diversi finiscono per non tornare.
 *
 * Da leggere con una cautela, che vale la pena ripetere dove i numeri si
 * guardano: **le ore non registrate non sono ore non lavorate**. La copertura
 * dice quanto del contratto è *rendicontato*.
 */
export const timesheetAnalyticsSchema = z.object({
  month: z.string(),
  /** Da dove vengono le assenze: dal calendario, o solo dedotte. */
  calendar: z.object({
    attivo: z.boolean(),
    lettoIl: z.string().nullable(),
    /** Righe del calendario che non si sono capite: si ignorano, ma si contano. */
    ignorati: z.number(),
  }),
  /**
   * Le settimane del mese, ognuna coi soli giorni che nel mese ci stanno: la
   * prima e l'ultima sono spesso frammenti (agosto 2026 comincia di sabato).
   */
  weeks: z.array(
    z.object({
      /** Il lunedì della settimana ISO. */
      week: z.string(),
      from: z.string(),
      to: z.string(),
      /** Tagliata dal confine del mese. */
      partial: z.boolean(),
    }),
  ),
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      isActive: z.boolean(),
      /** Ore da contratto: il denominatore. */
      weeklyHours: z.number(),
      weeks: z.array(
        z.object({
          week: z.string(),
          hours: z.number(),
          expected: z.number(),
          /**
           * Giorni feriali senza ore, senza movimenti e **senza una riga sul
           * calendario**: assenza dedotta, non dichiarata. È la domanda da
           * fare, e non va confusa con le ferie.
           */
          untracked: z.number(),
          /** Percentuale di ore rendicontate sul dovuto; `null` senza contratto. */
          coverage: z.number().nullable(),
        }),
      ),
      /** Come ha distribuito il suo tempo, con la quota sul proprio totale. */
      projects: z.array(
        z.object({
          name: z.string(),
          hours: z.number(),
          share: z.number(),
          /** Le stesse ore, settimana per settimana (stesso ordine di `weeks`). */
          weeks: z.array(z.number()),
        }),
      ),
      hours: z.number(),
      expected: z.number(),
      coverage: z.number().nullable(),
    }),
  ),
  /** La distribuzione complessiva: dove è finito il mese di tutti. */
  projects: z.array(z.object({ name: z.string(), hours: z.number(), share: z.number() })),
  hours: z.number(),
  expected: z.number(),
});
export type TimesheetAnalytics = z.infer<typeof timesheetAnalyticsSchema>;
