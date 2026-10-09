import type { ReactNode } from "react";

/**
 * Quello che il pannello del task sa di una **richiesta di supporto**
 * (08/10/2026): se qualcun altro la sta gestendo (e allora si legge e basta),
 * chi, come prenderla comunque, e le bande da mostrare in cima. Lo riempie lo
 * slot `useRichiesta` del modulo dei ticket; senza, un task non è mai una
 * richiesta.
 */
export interface RichiestaDelTask {
  inCaricoAdAltri: boolean;
  bloccataDa: string | null;
  prendiInCarico: () => void;
  bande: ReactNode;
}

const NESSUNA: RichiestaDelTask = {
  inCaricoAdAltri: false,
  bloccataDa: null,
  prendiInCarico: () => undefined,
  bande: null,
};

/** Il valore del nucleo: nessuna richiesta, nessuna banda, niente da prendere. */
export function useNessunaRichiesta(): RichiestaDelTask {
  return NESSUNA;
}
