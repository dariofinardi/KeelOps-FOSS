import { createContext, useContext } from "react";
import { UserRole } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";

/**
 * **Crea un'offerta da un task** (06/10/2026): il dialogo è montato una volta
 * sola nel guscio dell'applicazione (`DealFromTaskProvider`), e il menu
 * contestuale e il pannello del task chiedono soltanto «da questo task». Il
 * menu costruisce voci, non può tenere un dialogo suo.
 *
 * In un file a sé, senza il dialogo: lo importano i pannelli dei task, che il
 * dialogo (attraverso i task) importerebbe a sua volta.
 */
export const DealFromTaskContext = createContext<((taskId: string) => void) | null>(null);

/**
 * Il comando c'è per chi può essere manager di qualcosa (progetto o area) e per
 * l'amministratore; quale task esattamente lo decide il server, con la regola
 * di `from-task.ts`. Mai sulle offerte stesse.
 */
export function useCreateDealFromTaskCommand(): ((taskId: string) => void) | null {
  const apri = useContext(DealFromTaskContext);
  const user = useCurrentUser();
  if (!apri) return null;
  if (user.role !== UserRole.ADMIN && !user.isManager) return null;
  return apri;
}
