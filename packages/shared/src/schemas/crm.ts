import { z } from "zod";
import { userRefSchema } from "./tasks";

export const crmNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: userRefSchema,
});
export type CrmNote = z.infer<typeof crmNoteSchema>;

export const companyListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  vatNumber: z.string().nullable(),
  city: z.string().nullable(),
  contactCount: z.number().int(),
  dealCount: z.number().int(),
  /** Progetti intestati al cliente, contati su quelli che l'utente può vedere. */
  projectCount: z.number().int(),
});
export type CompanyListItem = z.infer<typeof companyListItemSchema>;

export const linkedDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  stageName: z.string(),
  stageColor: z.string(),
  dealValue: z.number().nullable(),
});
export type LinkedDeal = z.infer<typeof linkedDealSchema>;

export const companyDetailSchema = companyListItemSchema.extend({
  notes: z.string().nullable(),
  contacts: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().nullable() })),
  deals: z.array(linkedDealSchema),
  crmNotes: z.array(crmNoteSchema),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;

export const upsertCompanySchema = z.object({
  name: z.string().min(1).max(200),
  vatNumber: z.string().max(30).nullish(),
  city: z.string().max(100).nullish(),
  notes: z.string().max(10000).nullish(),
});
export type UpsertCompanyInput = z.infer<typeof upsertCompanySchema>;

/**
 * **Trova o crea un'azienda per nome** (16/09/2026): la strada morbida di chi
 * scrive il nome di un'azienda in un modulo e salva. Se esiste già — anche
 * scritta diversa: «Jugaad srl» per «Jugaad» — si usa quella; se no si crea.
 */
export const resolveCompanySchema = upsertCompanySchema.pick({
  name: true,
  vatNumber: true,
  city: true,
});
export type ResolveCompanyInput = z.infer<typeof resolveCompanySchema>;

export const resolvedCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Vero se l'azienda non c'era e l'ha appena creata questa richiesta. */
  created: z.boolean(),
});
export type ResolvedCompany = z.infer<typeof resolvedCompanySchema>;

/** L'azienda che ha già questo nome, se c'è: per dirlo mentre si scrive. */
export const companyMatchSchema = z.object({
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type CompanyMatch = z.infer<typeof companyMatchSchema>;

export const contactListItemSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roleTitle: z.string().nullable(),
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  dealCount: z.number().int(),
});
export type ContactListItem = z.infer<typeof contactListItemSchema>;

export const contactDetailSchema = contactListItemSchema.extend({
  deals: z.array(linkedDealSchema),
  crmNotes: z.array(crmNoteSchema),
});
export type ContactDetail = z.infer<typeof contactDetailSchema>;

export const upsertContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: z.string().max(50).nullish(),
  roleTitle: z.string().max(100).nullish(),
  companyId: z.string().nullish(),
});
export type UpsertContactInput = z.infer<typeof upsertContactSchema>;

export const createCrmNoteSchema = z.object({
  body: z.string().min(1).max(10000),
});
export type CreateCrmNoteInput = z.infer<typeof createCrmNoteSchema>;

export const importContactsResultSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  companiesCreated: z.number().int(),
});
export type ImportContactsResult = z.infer<typeof importContactsResultSchema>;
