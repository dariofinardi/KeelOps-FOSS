import { useEffect, useState } from "react";

/**
 * Valore che si aggiorna solo quando l'originale resta fermo per `delayMs`.
 *
 * Usato dalle caselle di ricerca: l'input resta reattivo a ogni tasto, ma la
 * query (che sul server calcola anche le facet, diversi groupBy) parte una sola
 * volta a digitazione finita invece che a ogni carattere.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
