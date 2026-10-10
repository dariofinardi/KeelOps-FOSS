// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

/**
 * Ordine delle colonne di una kanban, per-utente. La `key` identifica la
 * bacheca (es. "task:ADMIN", "deal", "board:<id>"); `order` è la lista degli id
 * colonna nell'ordine voluto. Array vuoto = torna all'ordine standard.
 */
export const updateColumnOrderSchema = z.object({
  key: z.string().min(1).max(80),
  order: z.array(z.string()).max(100),
});
export type UpdateColumnOrderInput = z.infer<typeof updateColumnOrderSchema>;

/** Mappa chiave-bacheca → ordine colonne, restituita dal profilo. */
export type ColumnOrderMap = Record<string, string[]>;
