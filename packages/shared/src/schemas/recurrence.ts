import { z } from "zod";
import { attachmentSchema, dateOnly, userRefSchema } from "./tasks";
import { activityTypeRefSchema } from "./activity-types";

export const recurrenceTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  rrule: z.string(),
  /** Descrizione leggibile della regola, generata dal server. */
  ruleText: z.string(),
  dtstart: dateOnly,
  isActive: z.boolean(),
  assignee: userRefSchema.nullable(),
  supervisor: userRefSchema.nullable(),
  activityType: activityTypeRefSchema.nullable(),
  /** Offerta di riferimento: le occorrenze restano nello scadenzario. */
  relatedDeal: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Stato iniziale scelto per le occorrenze (null = primo stato della categoria). */
  initialStatus: z.object({ id: z.string(), name: z.string(), color: z.string() }).nullable(),
  nextOccurrences: z.array(dateOnly),
  attachments: z.array(attachmentSchema),
  /** true se l'utente corrente può modificarla o eliminarla (chi l'ha creata, o un admin). */
  canManage: z.boolean(),
  /**
   * Solo nella risposta all'aggiornamento: cambiando la pianificazione (regola
   * o prima occorrenza) le occorrenze future non lavorate vengono **eliminate e
   * rigenerate**, con id nuovi. Chi stava guardando una di quelle si ritrova
   * davanti un record che non esiste più — e finché non lo sapeva, continuava a
   * modificarlo ricevendo "task non trovato" e perdendo quello che scriveva
   * (14/08/2026).
   */
  occurrencesRegenerated: z.boolean().optional(),
});
export type RecurrenceTemplate = z.infer<typeof recurrenceTemplateSchema>;

export const createRecurrenceTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullish(),
  rrule: z.string().min(1).max(500),
  dtstart: dateOnly,
  assigneeId: z.string().nullish(),
  supervisorId: z.string().nullish(),
  activityTypeId: z.string().nullish(),
  relatedDealId: z.string().nullish(),
  initialStatusId: z.string().nullish(),
});
export type CreateRecurrenceTemplateInput = z.infer<typeof createRecurrenceTemplateSchema>;

export const updateRecurrenceTemplateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).nullish(),
  rrule: z.string().min(1).max(500).optional(),
  dtstart: dateOnly.optional(),
  assigneeId: z.string().nullish(),
  supervisorId: z.string().nullish(),
  activityTypeId: z.string().nullish(),
  relatedDealId: z.string().nullish(),
  initialStatusId: z.string().nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateRecurrenceTemplateInput = z.infer<typeof updateRecurrenceTemplateSchema>;

export const previewRecurrenceSchema = z.object({
  rrule: z.string().min(1).max(500),
  dtstart: dateOnly,
  count: z.number().int().min(1).max(20).default(5),
});
export type PreviewRecurrenceInput = z.infer<typeof previewRecurrenceSchema>;

export const previewRecurrenceResultSchema = z.object({
  occurrences: z.array(dateOnly),
  ruleText: z.string(),
});
export type PreviewRecurrenceResult = z.infer<typeof previewRecurrenceResultSchema>;
