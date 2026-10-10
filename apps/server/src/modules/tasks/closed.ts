// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { hideClosedTasks } from "@kancrm/shared";

/**
 * La regola sta in `@kancrm/shared` perché la usano in due: qui per il `where`
 * della query, e il kanban per sapere se una colonna chiusa è stata caricata
 * davvero o va ancora aperta con la spunta "Mostra chiusi".
 */
export function closedTaskWhere(filters: {
  includeClosed?: boolean;
  statusId?: string | null;
  q?: string | null;
}): { status?: { isClosed: boolean } } {
  return hideClosedTasks(filters) ? { status: { isClosed: false } } : {};
}
