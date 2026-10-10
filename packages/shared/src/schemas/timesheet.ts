// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { MAX_HOURS_PER_DAY, roundHours } from "../hours";
import { weekStartOf } from "../timesheet-period";
import { dateOnly } from "./tasks";
import { isValidPeriod } from "../timesheet-period";

export const monthString = z.string().regex(/^\d{4}-\d{2}$/, "Formato mese non valido (YYYY-MM)");

/**
 * Il periodo della griglia: un mese (`2026-08`) o una settimana (`2026-08-03`,
 * il lunedì che la apre). Le regole di calcolo stanno in `timesheet-period.ts`;
 * qui c'è solo la porta d'ingresso. Chi non lo manda ha il mese corrente, come
 * prima.
 */
export const periodString = z
  .string()
  .refine(isValidPeriod, "Periodo non valido: attesi YYYY-MM oppure il lunedì YYYY-MM-DD");

/**
 * Una settimana, indicata dal **suo lunedì** (`2026-08-17`). Si controlla che
 * lo sia davvero: accettare un mercoledì vorrebbe dire generare un documento
 * intitolato a sette giorni che non sono la settimana di nessuno.
 */
export const weekString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato settimana non valido (YYYY-MM-DD)")
  .refine((value) => weekStartOf(value) === value, "La settimana si indica con il suo lunedì");

export const upsertTimeEntrySchema = z.object({
  taskId: z.string(),
  date: dateOnly,
  /**
   * Centesimi di ora (4,5 · 4,2 · 0,75); 0 elimina la registrazione. Si
   * arrotonda in ingresso invece di rifiutare: un client che manda 4,247
   * intende un valore valido, e il centesimo più vicino è ciò che voleva
   * scrivere.
   */
  hours: z
    .number()
    .min(0)
    .max(MAX_HOURS_PER_DAY, `Massimo ${MAX_HOURS_PER_DAY} ore al giorno`)
    .transform(roundHours),
  note: z.string().max(500).nullish(),
});
export type UpsertTimeEntryInput = z.infer<typeof upsertTimeEntrySchema>;

export const timesheetTaskRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  /** Nome progetto, oppure "Scadenzario"/"Offerte" per ADMIN/DEAL. */
  context: z.string(),
  /** Azienda cliente del task o del suo progetto: due progetti si somigliano, i clienti no. */
  company: z.string().nullable(),
  /** Contatori per le sbirciatine sulla riga (graffetta e fumetto). */
  attachmentCount: z.number(),
  commentCount: z.number(),
  /**
   * Task già chiuso. **Si può comunque scegliere**: si chiude un lavoro e poi
   * si registrano le ore, non il contrario (14/08/2026). Serve solo a dirlo in
   * tendina, così nessuno si chiede perché quel task è ancora lì.
   */
  isClosed: z.boolean(),
  /**
   * **Nato come richiesta di supporto.** Serve solo a dirlo nella griglia: chi
   * apre un ticket di solito ci ha lavorato prima (le prove, il giro rifatto,
   * la schermata), e vedere da dove viene la riga aiuta a ricordare quelle ore.
   * Nessun dato nuovo in banca dati: è lo stesso task, letto per com'è nato.
   */
  fromTicket: z.boolean(),
});
export type TimesheetTaskRef = z.infer<typeof timesheetTaskRefSchema>;

/**
 * Una pagina della tendina "aggiungi un task alla griglia": l'elenco arriva a
 * blocchi, perché senza cercare parte da quello che si ha in mano (assegnati o
 * supervisionati) e con centinaia di task non ha senso servirli tutti insieme.
 */
export const timesheetTaskPageSchema = z.object({
  items: z.array(timesheetTaskRefSchema),
  /** C'è dell'altro dopo questi: la tendina lo chiede scorrendo. */
  hasMore: z.boolean(),
});
export type TimesheetTaskPage = z.infer<typeof timesheetTaskPageSchema>;

/**
 * "Compila dalle attività": aggiunge alla griglia una riga per ogni task su cui
 * l'utente ha fatto qualcosa **nel periodo visualizzato** (commenti, allegati,
 * cambi di stato, modifiche — ciò che ActivityLog registra). Righe vuote, da
 * valorizzare: il gesto è esplicito e senza perdita. Guardando una settimana
 * guarda la settimana: la finestra è quella che si ha davanti, altrimenti il
 * pulsante riempirebbe la griglia di lavoro di altri giorni (12/08/2026).
 */
export const autoRowsSchema = z.object({ period: periodString });
export type AutoRowsInput = z.infer<typeof autoRowsSchema>;

export const autoRowsResultSchema = z.object({
  /** Quante righe nuove sono comparse (0 = era già tutto in griglia). */
  added: z.number().int(),
});
export type AutoRowsResult = z.infer<typeof autoRowsResultSchema>;

/**
 * Ore **suggerite** in una casella vuota: si vedono in grigio dentro la cella e
 * si confermano riscrivendole. Non sono ore registrate e non entrano in nessun
 * totale finché la persona non le scrive (14/08/2026).
 */
export const timesheetHintSchema = z.object({
  taskId: z.string(),
  /** Giorno YYYY-MM-DD. */
  date: z.string(),
  hours: z.number(),
});
export type TimesheetHint = z.infer<typeof timesheetHintSchema>;

export const timesheetRowSchema = z.object({
  task: timesheetTaskRefSchema,
  /** Mappa YYYY-MM-DD → ore. */
  entries: z.record(z.string(), z.number()),
  total: z.number(),
});
export type TimesheetRow = z.infer<typeof timesheetRowSchema>;

export const timesheetMonthSchema = z.object({
  /** Il periodo servito: mese (`2026-08`) o settimana (`2026-08-03`). */
  period: periodString,
  userId: z.string(),
  /** La griglia è modificabile solo dal proprietario (e se il mese non è chiuso). */
  editable: z.boolean(),
  /**
   * Mese chiuso dall'admin: nessuna modifica consentita. Per una settimana a
   * cavallo di due mesi basta che uno dei due sia chiuso — le ore di quei
   * giorni non si toccano comunque.
   */
  locked: z.boolean(),
  rows: z.array(timesheetRowSchema),
  total: z.number(),
  /**
   * La vista aggregata è **parziale**: chi guarda non vede tutti i timesheet,
   * solo le ore sui task che supervisiona e sui progetti che guida. Senza
   * questo flag la griglia si svuotava in silenzio — un admin non elevato
   * (dall'11/08/2026 lavora da membro) sceglieva quattro colleghi e trovava
   * una riga, convinto che i dati fossero spariti (18/08/2026).
   */
  filtered: z.boolean().optional(),
});
export type TimesheetMonth = z.infer<typeof timesheetMonthSchema>;

export const timesheetSummaryRowSchema = z.object({
  label: z.string(),
  hours: z.number(),
  /**
   * Progetto (o modulo) della riga: valorizzato raggruppando per task, dove il
   * solo titolo non basta a capire di cosa si parla — "Test e bug fixing" esiste
   * in mezzo progetto. Null negli altri raggruppamenti, che il contesto ce
   * l'hanno già nell'etichetta.
   */
  context: z.string().nullable(),
});
export type TimesheetSummaryRow = z.infer<typeof timesheetSummaryRowSchema>;

/** Utente selezionabile nel timesheet: include chi è disattivato ma ha registrato ore. */
export const timesheetUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
export type TimesheetUser = z.infer<typeof timesheetUserSchema>;

/** Ripartizione ore per progetto con il dettaglio per persona (accordion). */
export const timesheetBreakdownRowSchema = z.object({
  label: z.string(),
  hours: z.number(),
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      isActive: z.boolean(),
      hours: z.number(),
    }),
  ),
});
export type TimesheetBreakdownRow = z.infer<typeof timesheetBreakdownRowSchema>;

export const SummaryGroupBy = {
  USER: "user",
  PROJECT: "project",
  TASK: "task",
} as const;
export type SummaryGroupBy = (typeof SummaryGroupBy)[keyof typeof SummaryGroupBy];

/**
 * Report ore per progetto: le ore registrate su ogni task, divise per persona.
 * Serve a chi prepara un'offerta: si scelgono i task (a mano o filtrando sul
 * titolo) e si legge quanto è costata quell'attività, e da chi — la tariffa
 * dipende da chi ha lavorato.
 */
export const projectTaskHoursSchema = z.object({
  users: z.array(z.object({ id: z.string(), name: z.string() })),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      closed: z.boolean(),
      /** Chi lo ha eseguito (assegnatario), se c'è. */
      assignee: z.string().nullable(),
      /** Lo stato attuale del task. */
      status: z.string().nullable(),
      createdAt: z.string(),
      /** L'ultimo cambio di stato registrato nello storico. */
      statusChangedAt: z.string().nullable(),
      total: z.number(),
    }),
  ),
  /**
   * Le ore **per persona e per giorno**: una riga per utente+task+giorno, che è
   * la grana con cui il timesheet le registra. Serve a contare le **giornate**
   * senza contarne una due volte — due ore su un task e due su un altro nello
   * stesso giorno sono UNA giornata da quattro ore — e quel conto dipende da
   * quali task si sono selezionati, quindi non si può precalcolare (26/08/2026).
   */
  entries: z.array(
    z.object({
      taskId: z.string(),
      userId: z.string(),
      /** Giorno in cui le ore sono state registrate (YYYY-MM-DD). */
      day: dateOnly,
      hours: z.number(),
    }),
  ),
});
export type ProjectTaskHours = z.infer<typeof projectTaskHoursSchema>;
