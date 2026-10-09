import { z } from "zod";
import { ActivityCategory } from "../enums";

export const groupMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  /** Manager del gruppo: legge le attività dei membri, gestisce i membri, configura stati e tipi. */
  isManager: z.boolean(),
});
export type GroupMemberInfo = z.infer<typeof groupMemberSchema>;

export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * Area di lavoro che il gruppo governa (null = nessuna). Chi ne è manager
   * legge i task di quell'area — di chiunque siano — e ne configura stati e
   * tipi. Cosa diversa dagli scope di visibilità, che dicono cosa il gruppo
   * PUÒ VEDERE: qui si dice cosa GOVERNA.
   */
  managedArea: z.nativeEnum(ActivityCategory).nullable(),
  /**
   * **Il plugin che ha chiesto questo gruppo**, se non è nato a mano: il suo
   * `nick` e la chiave con cui lui lo ritrova (22/09/2026). Resta un gruppo
   * come gli altri — si rinomina, si cancella, i membri li mette
   * l'amministratore — ma la pagina dice da dove viene, e il giorno in cui un
   * plugin si potrà disinstallare si saprà cosa ha lasciato.
   */
  plugin: z
    .object({ nick: z.string(), chiave: z.string().nullable() })
    .nullable(),
  members: z.array(groupMemberSchema),
});
export type Group = z.infer<typeof groupSchema>;

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  /** null = il gruppo non governa nessuna area. */
  managedArea: z.nativeEnum(ActivityCategory).nullish(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const updateGroupMembersSchema = z.object({
  userIds: z.array(z.string()),
  /**
   * Id dei membri con ruolo di manager (sottoinsieme di userIds). Solo l'admin
   * può cambiarli: se omesso — o se a salvare è un manager — i flag esistenti
   * vengono conservati per i membri che restano.
   */
  managerIds: z.array(z.string()).optional(),
});
export type UpdateGroupMembersInput = z.infer<typeof updateGroupMembersSchema>;
