// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quando i task chiusi restano fuori dalla lista.
 *
 * La spunta "Mostra chiusi" tiene pulite le viste: lo scadenzario di ogni
 * giorno è fatto di lavoro aperto. Ma il filtro nasconde anche quello che è
 * stato chiesto per nome, e allora smette di aiutare:
 *
 * - scegliendo **uno stato preciso** nella tendina — per esempio "Non rinnova
 *   più", che è uno stato chiuso — la lista tornava vuota: `statusId` e
 *   `isClosed: false` si escludono a vicenda. La colonna esiste, il task c'è
 *   dentro, e la pagina diceva che non c'era niente. Un task che non si
 *   rinnova non è un task cancellato (19/08/2026);
 * - **cercando un titolo**, chi scrive "Newsletter mensile" vuole quel task,
 *   non i soli task aperti con quel nome.
 *
 * In entrambi i casi la domanda è già specifica: nasconderne la risposta è
 * solo un modo per farla sembrare sbagliata.
 */
export function hideClosedTasks(filters: {
  includeClosed?: boolean;
  statusId?: string | null;
  q?: string | null;
}): boolean {
  if (filters.includeClosed) return false;
  if (filters.statusId) return false;
  if (filters.q) return false;
  return true;
}
