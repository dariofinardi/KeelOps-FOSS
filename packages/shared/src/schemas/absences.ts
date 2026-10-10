// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { AbsenceKind, AbsenceSource } from "../enums";

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "giorno YYYY-MM-DD");

/** Una riga del registro delle assenze, come la legge l'interfaccia. */
export const absenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  day: dayString,
  kind: z.nativeEnum(AbsenceKind),
  category: z.string(),
  hours: z.number().nullable(),
  source: z.nativeEnum(AbsenceSource),
  title: z.string().nullable(),
  note: z.string().nullable(),
  createdById: z.string().nullable(),
  updatedAt: z.string(),
});
export type AbsenceRow = z.infer<typeof absenceSchema>;

/** Scrivere (o riscrivere) la riga manuale di una persona per un giorno. */
export const absenceUpsertSchema = z.object({
  kind: z.nativeEnum(AbsenceKind),
  /** La parola del vocabolario; per NONE può mancare. */
  category: z.string().trim().min(1).max(40).optional(),
  /** Ore di assenza; assente o null = giornata intera. */
  hours: z.number().positive().max(24).nullable().optional(),
  /** Al massimo 190 caratteri: su MariaDB la colonna è VARCHAR(191). */
  note: z.string().trim().max(190).nullable().optional(),
});
export type AbsenceUpsertInput = z.infer<typeof absenceUpsertSchema>;

/** Scrivere più giorni in una volta (un periodo di ferie). */
export const absenceRangeSchema = absenceUpsertSchema.extend({
  from: dayString,
  to: dayString,
});
export type AbsenceRangeInput = z.infer<typeof absenceRangeSchema>;

/** Una persona di cui si possono vedere (e forse modificare) le assenze. */
export const absencePersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  editable: z.boolean(),
});
export type AbsencePerson = z.infer<typeof absencePersonSchema>;

/**
 * La sezione `assenze` di `etc/config.json`, come la vede e la scrive il super
 * admin. L'indirizzo del calendario è una credenziale: in lettura arriva
 * mascherato, in scrittura si manda solo per cambiarlo.
 */
export const absenceConfigSchema = z.object({
  calendarUrl: z.string().trim().max(2000).optional(),
  alias: z.record(z.string().trim().min(1).max(60), z.string().trim().email()),
  ignora: z.array(z.string().trim().min(1).max(60)),
  regole: z.object({
    assenza: z.array(z.string().trim().min(1).max(40)),
    presenza: z.array(z.string().trim().min(1).max(40)),
  }),
});
export type AbsenceConfigInput = z.infer<typeof absenceConfigSchema>;

/**
 * **Le codifiche di presenza e di assenza** (18/09/2026): una sigla con la sua
 * descrizione — `FE` Ferie, `MA` Malattia, `PG` Permessi 104, `SW` Smart
 * working. La sigla è ciò che si legge nella griglia e si sceglie nella
 * finestra del giorno; sul calendario vale solo scritta in maiuscolo e da
 * sola («MA», non «ma»): alcune sigle sono anche parole italiane.
 *
 * Le configura il super admin o un manager dell'area amministrativa.
 */
export const absenceCodeSchema = z.object({
  codice: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "La sigla è di 1-6 lettere o cifre, senza spazi"),
  tipo: z.enum(["assenza", "presenza"]),
  descrizione: z.string().trim().min(1, "La descrizione è obbligatoria").max(60),
});
export type AbsenceCode = z.infer<typeof absenceCodeSchema>;

export const absenceCodesInputSchema = z.object({
  codifiche: z
    .array(absenceCodeSchema)
    .max(60)
    .superRefine((codifiche, ctx) => {
      const viste = new Set<string>();
      for (const [i, c] of codifiche.entries()) {
        if (viste.has(c.codice)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "codice"],
            message: `La sigla ${c.codice} è ripetuta`,
          });
        }
        viste.add(c.codice);
      }
    }),
});
export type AbsenceCodesInput = z.infer<typeof absenceCodesInputSchema>;
