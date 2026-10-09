import { z } from "zod";
import { ActivityCategory } from "../enums";

export const activityTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.nativeEnum(ActivityCategory),
  color: z.string(),
  order: z.number().int(),
  /** I task di questo tipo sono incontri: raccolgono note e decisioni di altri task. */
  isMeeting: z.boolean().default(false),
});
export type ActivityType = z.infer<typeof activityTypeSchema>;

/** Riferimento sintetico usato nei DTO dei task. */
export const activityTypeRefSchema = activityTypeSchema.pick({
  id: true,
  name: true,
  color: true,
  category: true,
  isMeeting: true,
});
export type ActivityTypeRef = z.infer<typeof activityTypeRefSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido");

/** Creazione di un tipo di attività (admin o manager di gruppo). */
export const createActivityTypeSchema = z.object({
  name: z.string().min(1).max(60),
  category: z.nativeEnum(ActivityCategory),
  color: hexColor,
  isMeeting: z.boolean().default(false),
});
export type CreateActivityTypeInput = z.infer<typeof createActivityTypeSchema>;

/** La categoria non si cambia: sposterebbe i task in un altro flusso di stati. */
export const updateActivityTypeSchema = createActivityTypeSchema.omit({ category: true }).partial();
export type UpdateActivityTypeInput = z.infer<typeof updateActivityTypeSchema>;
