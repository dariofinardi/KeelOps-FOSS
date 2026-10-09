import { z } from "zod";

export const Currency = {
  EUR: "EUR",
  USD: "USD",
  GBP: "GBP",
  CHF: "CHF",
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const Locale = {
  /** "Automatica": segue il browser, con l'inglese come ripiego. Il default. */
  AUTO: "auto",
  IT: "it",
  EN: "en",
  FR: "fr",
  DE: "de",
  ES: "es",
  PT: "pt",
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

/**
 * Tema dell'interfaccia scelto dall'utente:
 *  - auto: segue il sistema (chiaro di giorno, scuro di notte)
 *  - light: chiaro minimal (bianco/nero, il tema storico)
 *  - dark: notte (scuro fisso)
 *  - company: tema aziendale definito dall'amministratore
 */
export const AppTheme = {
  AUTO: "auto",
  LIGHT: "light",
  DARK: "dark",
  COMPANY: "company",
} as const;
export type AppTheme = (typeof AppTheme)[keyof typeof AppTheme];

export const updateProfileSchema = z.object({
  nickName: z.string().max(40).nullish(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido")
    .nullish(),
  currency: z.nativeEnum(Currency).optional(),
  locale: z.nativeEnum(Locale).optional(),
  theme: z.nativeEnum(AppTheme).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Esito di un import (Excel o iCal). */
export const importReportSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const ImportType = {
  TASKS: "tasks",
  DEALS: "deals",
  CONTACTS: "contacts",
  COMPANIES: "companies",
} as const;
export type ImportType = (typeof ImportType)[keyof typeof ImportType];

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  tasks: "Task (Scadenzario)",
  deals: "Offerte",
  contacts: "Contatti",
  companies: "Aziende",
};
