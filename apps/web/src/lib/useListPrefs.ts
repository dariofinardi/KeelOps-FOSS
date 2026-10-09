import { useCallback, useEffect, useState } from "react";
import { clampPage } from "./list-filters";

/**
 * Stato condiviso delle liste filtrabili (scadenzario, offerte): preferenze
 * persistite in localStorage + pagina corrente. Un'unica implementazione per il
 * pattern che prima era duplicato pagina per pagina:
 *  - caricamento tollerante (prefs corrotte o parziali → default);
 *  - ogni modifica dei filtri riparte dalla prima pagina;
 *  - `heal` applica le correzioni dell'autoguarigione (filtri che puntano a
 *    entità non più esistenti) senza toccare la pagina;
 *  - `clampPageTo` riporta la pagina nel range quando il totale si riduce.
 */
export function useListPrefs<T extends object>(storageKey: string, defaults: T) {
  const [prefs, setPrefs] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      // preferenze corrotte: si riparte dai default
    }
    return defaults;
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  }, [storageKey, prefs]);

  /** Modifica esplicita dell'utente: cambia i filtri e torna a pagina 1. */
  const update = useCallback((patch: Partial<T>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  /** Correzione automatica (oggetto vuoto = niente da fare): non tocca la pagina. */
  const heal = useCallback((patch: Partial<T>) => {
    if (Object.keys(patch).length > 0) setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Riporta la pagina nell'intervallo valido per il totale corrente. */
  const clampPageTo = useCallback((total: number, pageSize: number) => {
    setPage((current) => clampPage(current, total, pageSize));
  }, []);

  return { prefs, update, heal, page, setPage, clampPageTo };
}
