// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/**
 * **Quello che il modello ha letto negli allegati dell'offerta.**
 *
 * Tre principi, misurati sui documenti veri (21/08/2026, vedi
 * `PLAN_DOC_ANALISYS.md`):
 *
 *  1. **Importo, momento e citazione sono affidabili; l'etichetta no.** Sullo
 *     stesso documento, cambiando la lista delle categorie, «50% al collaudo»
 *     è diventato «consegna». Quindi il `tipo` è una proposta, e chi ha venduto
 *     conferma.
 *  2. **Quello che è dedotto si dichiara.** Dove il contratto dice «50%» e il
 *     modello scrive 2.050 €, il numero è giusto ma è un conto suo: `dedotto`
 *     lo marca, e la citazione resta quella letterale.
 *  3. **Un elenco troncato lo si dice.** Con un tetto agli elementi il JSON
 *     resta valido ma l'elenco può essere incompleto: `troncato` lo dichiara,
 *     invece di far credere che quello sia tutto.
 */
export const DEAL_ITEM_KINDS = [
  "acconto_firma",
  "avvio",
  "consegna",
  "collaudo",
  "manutenzione",
  "ricorrente",
  "altro",
] as const;
export type DealItemKind = (typeof DEAL_ITEM_KINDS)[number];

/** Una voce economica trovata in un documento. */
export const dealAnalysisItemSchema = z.object({
  id: z.string(),
  tipo: z.enum(DEAL_ITEM_KINDS),
  titolo: z.string(),
  /** Come sta scritto nel documento: "4.100 €", "30%", "" se non c'è. */
  importo: z.string(),
  /** La percentuale, quando la rata è espressa così. */
  quota: z.string(),
  /** A parole: "all'accettazione dell'offerta", "al collaudo positivo". */
  quando: z.string(),
  citazione: z.string(),
  /** Il modello ha fatto un conto invece di riportare un numero scritto. */
  dedotto: z.boolean(),
  /** Da quale allegato viene. */
  documento: z.string(),
});
export type DealAnalysisItem = z.infer<typeof dealAnalysisItemSchema>;

/** Una fase o attività di lavoro descritta nell'offerta. */
export const dealAnalysisActivitySchema = z.object({
  id: z.string(),
  titolo: z.string(),
  fase: z.string(),
  durata: z.string(),
  documento: z.string(),
});
export type DealAnalysisActivity = z.infer<typeof dealAnalysisActivitySchema>;

/** Un allegato letto, con quanto è costato leggerlo. */
export const dealAnalysisSourceSchema = z.object({
  name: z.string(),
  /** pdf | docx | drive | testo */
  format: z.string(),
  caratteri: z.number(),
  /** Perché non è stato letto, quando non lo è stato. */
  saltato: z.string().nullable(),
});
export type DealAnalysisSource = z.infer<typeof dealAnalysisSourceSchema>;

/**
 * Una riga come il commerciale l'ha confermata. Resta dentro la lettura, non
 * solo dentro i task creati: **l'offerta conserva quello che è stato deciso**,
 * e riaprendola mesi dopo si rilegge la proposta con le correzioni fatte —
 * altrimenti l'unica traccia sarebbe sparsa in dieci task.
 */
export const dealAnalysisConfirmedSchema = z.object({
  id: z.string(),
  titolo: z.string(),
  importo: z.string(),
  note: z.string(),
  admin: z.boolean(),
  progetto: z.boolean(),
});
export type DealAnalysisConfirmed = z.infer<typeof dealAnalysisConfirmedSchema>;

export const dealAnalysisPayloadSchema = z.object({
  sources: z.array(dealAnalysisSourceSchema),
  items: z.array(dealAnalysisItemSchema),
  activities: z.array(dealAnalysisActivitySchema),
  /** Elenchi arrivati al tetto: incompleti, e va detto. */
  troncato: z.object({ items: z.boolean(), activities: z.boolean() }),
  /** Secondi impiegati dal modello, in tutto. */
  secondi: z.number(),
  /** Cosa ha confermato il commerciale, quando ha creato i task. */
  confermate: z.array(dealAnalysisConfirmedSchema).optional(),
});
export type DealAnalysisPayload = z.infer<typeof dealAnalysisPayloadSchema>;

export const DEAL_ANALYSIS_STATES = ["queue", "running", "done", "failed", "cancelled"] as const;
export type DealAnalysisState = (typeof DEAL_ANALYSIS_STATES)[number];

export const dealAnalysisSchema = z.object({
  dealId: z.string(),
  dealTitle: z.string(),
  companyName: z.string().nullable(),
  state: z.enum(DEAL_ANALYSIS_STATES),
  model: z.string().nullable(),
  /** Due o tre parole, proposte dal modello leggendo l'apertura dell'offerta. */
  projectName: z.string().nullable(),
  payload: dealAnalysisPayloadSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  /** Quando i task sono stati creati: una proposta si applica una volta sola. */
  appliedAt: z.string().nullable(),
  /**
   * Gli allegati dell'offerta, per poterli **rileggere mentre si rivede**: chi
   * conferma un importo deve poter scorrere il documento da cui viene, senza
   * uscire dalla finestra e perdere le correzioni fatte.
   */
  attachments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      mimeType: z.string().nullable(),
    }),
  ),
});
export type DealAnalysis = z.infer<typeof dealAnalysisSchema>;

/** Una riga confermata dal commerciale, come esce dal modale. */
export const dealAnalysisRowInput = z.object({
  id: z.string(),
  titolo: z.string().min(1).max(200),
  importo: z.string().max(60),
  note: z.string().max(2000).optional(),
  /** Ne nasce un task per l'amministrazione. */
  admin: z.boolean(),
  /** Ne nasce un task nel progetto di sviluppo. */
  progetto: z.boolean(),
});

/**
 * Cosa creare. I due insiemi sono **indipendenti**: si può volere solo
 * l'amministrazione, solo il progetto, o entrambi — chi ha venduto sa quale
 * delle due cose serve, e obbligarlo a creare anche l'altra riempirebbe le
 * bacheche di task che nessuno ha chiesto.
 */
export const applyDealAnalysisInput = z.object({
  rows: z.array(dealAnalysisRowInput).min(1),
  /** A chi vanno le attività amministrative. */
  adminAssigneeId: z.string().nullable(),
  /**
   * **Un progetto che esiste già**, a cui aggiungere le attività invece di
   * crearne uno nuovo. Il caso normale quando l'offerta è un'evoluzione di un
   * lavoro in corso: «Atlante per Boreal» c'è già, e la commessa nuova ci entra
   * dentro (22/08/2026). Quando è valorizzato, `projectManagerId` e
   * `projectName` non contano: il progetto ha già il suo nome e la sua guida,
   * e cambiarli da qui sarebbe una modifica al progetto travestita da
   * conferma di una proposta.
   */
  projectId: z.string().nullish(),
  /** Chi guida il progetto **nuovo**: ne diventa supervisore e membro. */
  projectManagerId: z.string().nullable(),
  /** Due o tre parole: il nome del progetto **nuovo**. */
  projectName: z.string().max(80).optional(),
});
export type ApplyDealAnalysisInput = z.infer<typeof applyDealAnalysisInput>;
