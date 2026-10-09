import { z } from "zod";

/**
 * L'andamento dell'area tecnica: i numeri del pannello in "La mia giornata".
 *
 * Due letture, e non si mescolano: **la squadra** (flusso, coda, dove sono
 * finite le ore — nessun nome) e **la persona che guarda** (i propri numeri,
 * confrontati con sé stessa). L'elenco per persona esiste solo per chi guida
 * l'area, in ordine alfabetico: vedi il commento in `dev-metrics-service.ts`.
 */

/** Tempi mediani in giorni; `null` quando il campione è vuoto. */
export const devTimesSchema = z.object({
  presaInCarico: z.number().nullable(),
  lavorazione: z.number().nullable(),
  totale: z.number().nullable(),
  campione: z.number(),
  natiChiusi: z.number(),
});

/** Taglia del lavoro: ore per task chiuso. */
export const devSizeSchema = z.object({
  medianaOre: z.number().nullable(),
  q25: z.number().nullable(),
  q75: z.number().nullable(),
  conOre: z.number(),
  totali: z.number(),
});

export const devMetricsSchema = z.object({
  /** Estremi della finestra osservata (quattro settimane piene). */
  from: z.string(),
  to: z.string(),
  weeks: z.array(z.object({ week: z.string(), entrati: z.number(), usciti: z.number() })),
  team: z.object({
    aperti: z.number(),
    chiusi: z.number(),
    /**
     * Record di archivio importati (ClickUp, osTicket) chiusi nella finestra:
     * **non** contati fra le chiusure né nei tempi, ma dichiarati — erano 104
     * su 155, e tacerli avrebbe fatto sembrare sparito un pezzo di lavoro.
     */
    storico: z.number(),
    coda: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string(), count: z.number() }),
    ),
    tempi: devTimesSchema,
    taglia: devSizeSchema,
    orePerProgetto: z.array(z.object({ project: z.string().nullable(), hours: z.number() })),
    /**
     * Ore su progetti **senza azienda collegata**. Non è un indicatore di
     * lavoro: è ciò che manca per poterne fare uno. Il taglio "clienti vs
     * interno" era pronto, ma sui dati veri (18/08/2026) diceva il falso —
     * Atlante, 133 ore e il progetto più grosso, non ha l'azienda collegata e
     * finiva fra le interne; "Jugaad interne" ce l'ha e finiva fra i clienti.
     * Meglio dichiarare il buco che pubblicare un numero rovesciato.
     */
    oreSenzaCliente: z.number(),
    /**
     * Lavoro aperto che non è in mano a nessuno. Sta accanto alle quote delle
     * persone perché senza di lui la ripartizione della coda non torna a
     * cento, e perché 113 task su 349 senza assegnatario sono la prima cosa
     * da vedere in quella tabella.
     */
    nonAssegnati: z.number(),
    /** Di quelli, quanti sono ancora nella colonna d'ingresso. */
    nonAssegnatiDaFare: z.number(),
    /**
     * Lavoro aperto intestato a chi **non è più della squadra**: account
     * disattivati e ruoli esterni. Fuori da ogni conteggio — non è carico di
     * nessuno — ma dichiarato sotto la tabella: è lavoro da riassegnare, e
     * farlo sparire senza dirlo sarebbe il modo migliore per dimenticarlo.
     */
    fuoriSquadra: z.number(),
  }),
  me: z.object({
    aperti: z.number(),
    chiusi: z.number(),
    natiChiusi: z.number(),
    tempi: devTimesSchema,
    taglia: devSizeSchema,
    ore: z.number(),
    copertura: z.object({
      compilati: z.number(),
      /** Giorni in cui la persona ha davvero lavorato: il denominatore. */
      lavorati: z.number(),
      /** `null` quando non ha lavorato nemmeno un giorno: le ferie non sono un ritardo. */
      percento: z.number().nullable(),
    }),
  }),
  /**
   * **I limiti di lavoro in corso in sofferenza**, di chiunque e in qualunque
   * progetto — non solo dell'area tecnica: un limite superato altrove è
   * comunque una persona con troppe cose aperte.
   *
   * Si contano i task **assegnati** alla persona, aperti, in quello stato e in
   * quel progetto: non chi li supervisiona né chi li ha creati, che non li
   * stanno lavorando. Vale la pena saperlo leggendo i numeri: sulla bacheca,
   * spostare un task di progetto senza assegnatario lo prende in carico
   * (`autoAssign` in `tasks/update-service.ts`), quindi un carico può crescere
   * anche solo mettendo ordine.
   *
   * Come `people`, lo vede chi governa l'area: sono nomi di persone con il
   * loro carico. `null` agli altri.
   */
  wip: z
    .array(
      z.object({
        projectId: z.string(),
        projectName: z.string(),
        statusId: z.string(),
        statusName: z.string(),
        userId: z.string(),
        userName: z.string(),
        /** Task assegnati, aperti, in quello stato e in quel progetto. */
        count: z.number(),
        limit: z.number(),
        /** `oltre` = limite superato; `attenzione` = esattamente al limite. */
        level: z.enum(["attenzione", "oltre"]),
      }),
    )
    .nullable(),
  /** Solo a chi governa l'area; `null` agli altri. */
  people: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        /** Lavoro aperto in mano alla persona, adesso. */
        assegnati: z.number(),
        /**
         * Of those, how many are past their due date (08/10/2026): the delays
         * of the team, person by person, as the community panel promised.
         */
        inRitardo: z.number(),
        /** Di quelli, fermi nella colonna d'ingresso: assegnati e mai toccati. */
        daFare: z.number(),
        /** Gli altri: usciti dalla colonna d'ingresso. */
        inCorso: z.number(),
        chiusi: z.number(),
        ore: z.number(),
        copertura: z.number().nullable(),
      }),
    )
    .nullable(),
});

export type DevTimes = z.infer<typeof devTimesSchema>;
export type DevSize = z.infer<typeof devSizeSchema>;
export type DevMetrics = z.infer<typeof devMetricsSchema>;
