// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colore esadecimale non valido");

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  /** Numero di task che portano il tag (per l'elenco/filtro). */
  taskCount: z.number().int(),
});
export type Tag = z.infer<typeof tagSchema>;

/** Riferimento minimale usato sui task (senza conteggio). */
export const tagRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});
export type TagRef = z.infer<typeof tagRefSchema>;

export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: hexColor.nullish(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;
