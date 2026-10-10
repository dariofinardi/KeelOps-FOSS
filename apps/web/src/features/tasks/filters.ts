// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Logica dei filtri della lista task, tenuta pura per poterla testare.
 *
 * Due problemi reali che risolve:
 *  - un filtro salvato può puntare a un'entità che non esiste più (stato unito o
 *    eliminato, utente disattivato, tipo rimosso): la lista resta vuota senza che
 *    l'utente veda un filtro attivo, e non c'è modo di togliierlo dalla tendina.
 *  - la pagina corrente può finire fuori range quando il totale si riduce: la
 *    tabella appare vuota pur avendo record (prima si risolveva solo riavviando).
 */

import type { TaskFilters, TaskSortBy } from "@kancrm/shared";
import { activeCount, invalidSelections } from "@/lib/list-filters";

/** Filtri selezionabili nella lista task (stringa vuota = nessun filtro). */
export interface TaskFilterValues {
  statusId: string;
  assigneeId: string;
  activityTypeId: string;
  tagId: string;
  companyId: string;
}

/** Valori ammessi per ogni filtro, come arrivano dalle facet/tendine. */
export interface AvailableFilterOptions {
  statusIds: string[];
  assigneeIds: string[];
  activityTypeIds: string[];
  tagIds: string[];
  companyIds: string[];
}

/**
 * Quanti filtri sono attivi (per l'etichetta del pulsante "Azzera filtri").
 *
 * "Mostra chiusi" conta come filtro: resta acceso tra una visita e l'altra e
 * cambia cosa si vede in elenco — se non comparisse nel conteggio, l'utente non
 * avrebbe modo di capire perché sta vedendo dei task completati.
 */
export function activeFilterCount(values: TaskFilterValues, q = "", includeClosed = false): number {
  return activeCount(values, q) + (includeClosed ? 1 : 0);
}

/**
 * Filtri da azzerare perché puntano a valori non più disponibili. Ritorna solo le
 * chiavi da correggere (oggetto vuoto = tutto valido), così si può applicare come
 * patch ed evitare aggiornamenti di stato inutili.
 *
 * Le liste vuote non correggono nulla: significano "opzioni non ancora caricate",
 * non "nessun valore ammesso" — altrimenti al primo render si perderebbero i filtri.
 */
export function invalidFilters(
  values: TaskFilterValues,
  available: AvailableFilterOptions,
): Partial<TaskFilterValues> {
  return invalidSelections(values, {
    statusId: available.statusIds,
    assigneeId: available.assigneeIds,
    activityTypeId: available.activityTypeIds,
    tagId: available.tagIds,
    companyId: available.companyIds,
  });
}

/**
 * Query string della lista task: UNICO punto in cui i filtri diventano parametri.
 *
 * Nato da un bug reale: `dueWithinDays` era gestito da schema, server e tendina,
 * ma la serializzazione (fatta a mano dentro `useTasks`) non lo includeva — il
 * range di scadenza sembrava attivo e non filtrava niente, in nessuna vista.
 * Con la funzione pura il test elenca i parametri supportati e un filtro nuovo
 * che manca da qui fa fallire il test, non la produzione.
 */
export function taskListQuery(filters: Partial<TaskFilters>): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.statusId) params.set("statusId", filters.statusId);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.activityTypeId) params.set("activityTypeId", filters.activityTypeId);
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.category) params.set("category", filters.category);
  if (filters.includeProjectTasks) params.set("includeProjectTasks", "true");
  if (filters.dueWithinDays) params.set("dueWithinDays", String(filters.dueWithinDays));
  if (filters.includeClosed) params.set("includeClosed", "true");
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  return params.toString();
}

/**
 * Parametri dell'export CSV. L'export è uno scarico grezzo per scelta
 * (06/08/2026): il server onora SOLO questi filtri di base — mandare gli altri
 * farebbe credere che il file rispecchi la tabella, e non è così.
 */
export function taskExportQuery(filters: Partial<TaskFilters>): string {
  return taskListQuery({
    q: filters.q,
    statusId: filters.statusId,
    assigneeId: filters.assigneeId,
    includeClosed: filters.includeClosed,
    projectId: filters.projectId,
  });
}

export { clampPage } from "@/lib/list-filters";

/**
 * I criteri di ordinamento offerti dalla tendina, in ordine di utilità reale
 * (14/08/2026). Le etichette dicono **il risultato**, non il campo: "prima chi
 * scade" si capisce, "scadenza crescente" fa fermare a pensare.
 *
 * Il verso di partenza è sempre crescente — prima i più vecchi, prima chi scade
 * prima, dalla A alla Z — e si gira cliccando due volte l'intestazione in
 * tabella.
 */
export const TASK_SORT_OPTIONS: Array<{ value: TaskSortBy; label: string }> = [
  { value: "dueDate", label: "Scadenza: prima chi scade" },
  { value: "createdAt", label: "Creazione: prima i più vecchi" },
  { value: "title", label: "Titolo: dalla A alla Z" },
  { value: "status", label: "Stato" },
  { value: "assignee", label: "Assegnatario" },
];
