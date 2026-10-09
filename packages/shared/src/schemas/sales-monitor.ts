import { z } from "zod";
import { dateOnly } from "./tasks";

/**
 * Quello che un **monitor vendite** può vedere di un'offerta: un elenco chiuso di
 * campi, non il DTO interno filtrato.
 *
 * È una scelta di sicurezza: aggiungendo domani un campo all'offerta — un margine,
 * una nota interna, il motivo di una perdita — questo non lo eredita. Per esporre
 * qualcosa a un pubblico esterno bisogna scriverlo qui, di proposito.
 */
export const salesMonitorDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Azienda cliente (solo il nome). */
  companyName: z.string().nullable(),
  amount: z.number().nullable(),
  /** Probabilità di chiusura: la stessa che pesa il forecast. */
  probability: z.number().int().nullable(),
  stage: z.object({
    name: z.string(),
    color: z.string(),
    /** Posizione nella pipeline: ordinare per fase segue il percorso, non l'alfabeto. */
    order: z.number().int(),
    isWon: z.boolean(),
    isLost: z.boolean(),
  }),
  /** Commerciale che segue l'offerta (solo il nome). */
  ownerName: z.string().nullable(),
  expectedCloseDate: dateOnly.nullable(),
  /**
   * Il prossimo passo: il primo task aperto collegato, con **di cosa si tratta**
   * — tipo di attività, titolo e data (01/10/2026; dal 17/09 era la sola data).
   * Chi lo fa resta dentro. Null se non c'è nessun passo; `dueDate` null se il
   * passo c'è ma senza data.
   */
  nextStep: z
    .object({
      dueDate: dateOnly.nullable(),
      title: z.string(),
      type: z.object({ name: z.string(), color: z.string() }).nullable(),
    })
    .nullable(),
  /** Giorno della chiusura effettiva, per le trattative concluse. */
  closedAt: dateOnly.nullable(),
  attachmentCount: z.number().int(),
  /** Messaggi in chat: l'icona sulla scheda dice che c'è una conversazione. */
  commentCount: z.number().int(),
});
export type SalesMonitorDeal = z.infer<typeof salesMonitorDealSchema>;

/**
 * Quanta parte del giro d'affari di un mese è condivisa con i monitor vendite.
 *
 * Esce **solo la percentuale**, non gli importi: l'area non deve raccontare
 * quanto vale ciò che non mostra.
 */
export const salesMonitorCoverageSchema = z.object({
  /** "2026-09", oppure "senza-data": le stesse chiavi della previsione. */
  month: z.string(),
  /** Percentuale sul valore totale del mese, a una cifra decimale. Null se il mese non ha valore. */
  sharePercent: z.number().nullable(),
});
export type SalesMonitorCoverage = z.infer<typeof salesMonitorCoverageSchema>;

/** Voce di cronologia, già resa in italiano dal server. */
export const salesMonitorActivitySchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type SalesMonitorActivity = z.infer<typeof salesMonitorActivitySchema>;

export const salesMonitorAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** FILE o LINK: decide l'icona; l'indirizzo si chiede all'apertura. */
  type: z.string(),
});
export type SalesMonitorAttachment = z.infer<typeof salesMonitorAttachmentSchema>;

/**
 * Messaggio della chat dell'offerta. È la **stessa chat** che vedono dentro
 * l'azienda: i monitor vendite possono farci domande, e chi segue l'offerta risponde
 * dove è abituato invece che su un canale a parte.
 */
export const salesMonitorCommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type SalesMonitorComment = z.infer<typeof salesMonitorCommentSchema>;

export const salesMonitorDealDetailSchema = salesMonitorDealSchema.extend({
  activities: z.array(salesMonitorActivitySchema),
  attachments: z.array(salesMonitorAttachmentSchema),
  comments: z.array(salesMonitorCommentSchema),
});
export type SalesMonitorDealDetail = z.infer<typeof salesMonitorDealDetailSchema>;
