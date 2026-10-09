import { z } from "zod";

/** Lo stato della manutenzione, come lo racconta GET /api/maintenance. */
export const maintenanceStateSchema = z.object({
  active: z.boolean(),
  /** Messaggio facoltativo dell'amministratore, mostrato sulla pagina di cortesia. */
  message: z.string().nullable(),
  since: z.string().nullable(),
});
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;

/** POST /api/admin/maintenance: accendere o spegnere, con messaggio opzionale. */
export const setMaintenanceInput = z.object({
  active: z.boolean(),
  message: z.string().trim().max(300).optional(),
});
export type SetMaintenanceInput = z.infer<typeof setMaintenanceInput>;
