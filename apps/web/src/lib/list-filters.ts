/**
 * Utilità condivise dalle liste filtrabili (task, offerte, …).
 *
 * Due difetti che evitano, entrambi visti in produzione:
 *  - un filtro salvato che punta a un'entità non più esistente (stato unito,
 *    azienda eliminata, utente rimosso) svuota la lista mentre la tendina mostra
 *    "Tutti …": il filtro non è visibile e non si riesce a togliere.
 *  - una pagina fuori range, dopo che il totale si è ridotto, mostra una tabella
 *    vuota pur essendoci record.
 */

/**
 * Chiavi da azzerare perché il valore selezionato non è tra quelli ammessi.
 * Ritorna solo le correzioni, così si applica come patch senza aggiornamenti inutili.
 *
 * Un elenco di valori ammessi VUOTO non corregge nulla: significa "opzioni non
 * ancora caricate", non "nessun valore valido" — altrimenti al primo render si
 * perderebbero i filtri salvati.
 */
export function invalidSelections<K extends string>(
  values: Record<K, string>,
  allowed: Record<K, string[]>,
): Partial<Record<K, string>> {
  const patch: Partial<Record<K, string>> = {};
  for (const key of Object.keys(values) as K[]) {
    const value = values[key];
    const options = allowed[key] ?? [];
    if (value && options.length > 0 && !options.includes(value)) patch[key] = "";
  }
  return patch;
}

/** Quanti filtri sono attivi, contando anche il testo di ricerca. */
export function activeCount<K extends string>(values: Record<K, string>, q = ""): number {
  return Object.values<string>(values).filter(Boolean).length + (q.trim() ? 1 : 0);
}

/**
 * Pagina valida per il totale corrente: 1 senza record, altrimenti la pagina
 * richiesta limitata all'ultima esistente.
 */
export function clampPage(page: number, total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.ceil(total / pageSize));
}
