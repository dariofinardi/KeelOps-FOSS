// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { SelettoreDrive } from "@/edition/slots";

/**
 * **The Drive picker where there is none** (08/10/2026). The picker is the
 * commercial `google` module, lent through the slot `useSelettoreDrive`; the
 * attachment forms call `(slot.useSelettoreDrive ?? useNessunSelettoreDrive)()`
 * and, without it, show no Drive button.
 */
const NESSUNO: SelettoreDrive = { enabled: false, open: async () => [] };

export function useNessunSelettoreDrive(): SelettoreDrive {
  return NESSUNO;
}
