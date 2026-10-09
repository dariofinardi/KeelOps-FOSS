import type { ComponentType, ReactNode } from "react";
import { EDIZIONE_COMMERCIALE } from "./commercial/rotte";

/**
 * **Le pagine dell'edizione** (08/10/2026): le rotte che i moduli aggiungono
 * dentro il guscio dell'applicazione, le interfacce dedicate dei loro ruoli, e
 * i nomi dei moduli presenti — il menù li usa per mostrare le voci che ne
 * dipendono. Nella community è tutto vuoto.
 *
 * Le pagine sono `lazy`, come quelle del nucleo: questo file lo legge `App`,
 * e niente di commerciale entra nel bundle iniziale.
 */
export interface EdizioneWeb {
  /** I moduli presenti (`ticket`, `timesheet`, `area-investitori`…). */
  moduli: ReadonlySet<string>;
  /** Le rotte dentro `AppShell`. */
  rotte: ReadonlyArray<{ path: string; element: ReactNode }>;
  /** L'interfaccia dedicata di un ruolo che non è del nucleo. */
  appPerRuolo: Readonly<Partial<Record<string, ComponentType>>>;
}

export const edizione: EdizioneWeb = EDIZIONE_COMMERCIALE;
