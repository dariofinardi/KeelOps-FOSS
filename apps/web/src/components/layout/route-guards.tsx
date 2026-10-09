import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { UserRole } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";

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
