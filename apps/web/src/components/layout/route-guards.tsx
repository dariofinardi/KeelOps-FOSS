// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { UserRole } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { funzioneAccesa } from "@/lib/funzioni";

/*
 * Le guardie delle rotte (stavano in `App.tsx`): le usano le pagine del nucleo
 * e quelle dei moduli dell'edizione.
 */

/**
 * Chi **guida qualcosa** — un gruppo o un progetto, l'ambito non conta. Diverso
 * da `ManagerOrAdmin`, che protegge la **configurazione**: lì l'ambito conta.
 */
export function ManagerOnly({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (!user.isManager) return <Navigate to="/" replace />;
  return children;
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user.role !== UserRole.ADMIN) return <Navigate to="/bacheche" replace />;
  return children;
}

/** Pagine di configurazione aperte anche ai manager di gruppo (gruppi, stati e tipi). */
export function ManagerOrAdmin({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user.role !== UserRole.ADMIN && !user.isGroupManager) {
    return <Navigate to="/bacheche" replace />;
  }
  return children;
}

/**
 * **Un'area del nucleo che l'installazione può spegnere** (17/10/2026): spenta,
 * il suo indirizzo porta alla propria giornata, come chi non ha i permessi.
 * Il server la chiude da sé; qui si evita una pagina piena di 404.
 */
export function FunzioneAccesa({ chiave, children }: { chiave: string; children: ReactNode }) {
  const user = useCurrentUser();
  if (!funzioneAccesa(user, chiave)) return <Navigate to="/" replace />;
  return children;
}
