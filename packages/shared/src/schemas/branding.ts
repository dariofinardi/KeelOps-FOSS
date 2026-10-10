// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/**
 * Palette aziendali predefinite tra cui l'amministratore sceglie quella applicata
 * agli utenti col tema "Aziendale". Ognuna corrisponde a una classe CSS lato web
 * (.theme-<value>): jugaad = viola del logo, radaee = blu, padformusician = teal.
 */
export const CompanyTheme = {
  JUGAAD: "jugaad",
  RADAEE: "radaee",
  PADFORMUSICIAN: "padformusician",
} as const;
export type CompanyTheme = (typeof CompanyTheme)[keyof typeof CompanyTheme];

/** Titolo aziendale mostrato accanto al logo (vuoto = default "KeelOps"). */
export const BRANDING_TITLE_MAX = 40;

/** Branding aziendale visibile a tutti gli utenti (logo + titolo + palette attiva). */
export const brandingSchema = z.object({
  logoUrl: z.string().nullable(),
  /** Testo accanto al logo; null se non impostato (la UI mostra "KeelOps"). */
  title: z.string().nullable(),
  companyTheme: z.nativeEnum(CompanyTheme),
});
export type Branding = z.infer<typeof brandingSchema>;

/** Modifica del branding (solo admin): titolo e/o palette aziendale. */
export const updateBrandingSchema = z.object({
  companyTheme: z.nativeEnum(CompanyTheme).optional(),
  /** Stringa vuota → azzera il titolo (torna a "KeelOps"). */
  title: z.string().trim().max(BRANDING_TITLE_MAX).optional(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
