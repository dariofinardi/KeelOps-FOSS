// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido");

export const dealStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  order: z.number().int(),
  isWon: z.boolean(),
  isLost: z.boolean(),
  /** Fasi vinte: stato e assegnatario del task amministrativo generato (null = default). */
  wonTaskStatusId: z.string().nullable(),
  wonTaskAssigneeId: z.string().nullable(),
});
export type DealStage = z.infer<typeof dealStageSchema>;

export const createDealStageSchema = z.object({
  name: z.string().min(1).max(50),
  color: hexColor,
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  wonTaskStatusId: z.string().nullish(),
  wonTaskAssigneeId: z.string().nullish(),
});
export type CreateDealStageInput = z.infer<typeof createDealStageSchema>;

export const updateDealStageSchema = createDealStageSchema.partial();
export type UpdateDealStageInput = z.infer<typeof updateDealStageSchema>;
