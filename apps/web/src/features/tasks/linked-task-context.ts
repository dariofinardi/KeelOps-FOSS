// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useContext } from "react";

/**
 * **Aprire il task di un link interno** (06/10/2026). Chi mostra un record con
 * dei link ai task (il pannello dell'offerta) offre questo contesto: il task si
 * apre **sopra** di lui, e chiudendolo si torna al record di partenza. Senza
 * chi lo offre, si va alla pagina del task.
 *
 * In un file a sé, senza import dei pannelli: lo usano gli allegati, che i
 * pannelli importano — insieme farebbero un giro.
 */
export type ApriTaskCollegato = (taskId: string, taskKind?: string) => void;

export const LinkedTaskContext = createContext<ApriTaskCollegato | null>(null);

export function useOpenLinkedTask(): ApriTaskCollegato {
  const apri = useContext(LinkedTaskContext);
  return (
    apri ?? ((taskId) => window.location.assign(`/bacheche?task=${encodeURIComponent(taskId)}`))
  );
}

/**
 * Il link punta a un task di questa istanza? Serve solo alle etichette ("Apri il
 * task" invece di "Apri il link"): dove si va lo decide il server, che conosce
 * l'indirizzo pubblico vero.
 */
export function isTaskLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const link = new URL(url);
    return (
      link.origin === window.location.origin &&
      link.pathname.replace(/\/+$/, "") === "/bacheche" &&
      link.searchParams.has("task")
    );
  } catch {
    return false;
  }
}
