import { UserRole, type DealOwnerFilter } from "@kancrm/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * **Chi possiede un'offerta**: il commerciale assegnato o, se non c'è, chi l'ha
 * creata. Resta supervisore del task che nasce quando l'offerta si vince.
 */
export function ownerIdOf(deal: { assigneeId: string | null; creatorId: string }): string {
  return deal.assigneeId ?? deal.creatorId;
}

/**
 * Il filtro «di chi sono», come condizione Prisma.
 *
 * **Va messo dentro un `AND`**, non steso nell'oggetto del `where`: la ricerca
 * per titolo usa già un `OR`, e due `OR` fratelli nello stesso oggetto si
 * sovrascrivono a vicenda — è una trappola che questo repository ha già pagato
 * (vedi CLAUDE.md). Restituisce `undefined` quando non c'è niente da
 * restringere, così chi la usa può ometterla senza casi speciali.
 */
export function dealOwnerWhere(
  owner: DealOwnerFilter | undefined,
  userId: string,
): Prisma.TaskWhereInput | undefined {
  if (!owner || owner === "all") return undefined;
  // «Mia» comprende quelle che ho creato e non ho assegnato a nessuno:
  // altrimenti sparirebbero da entrambi i lati del filtro.
  const mie: Prisma.TaskWhereInput = {
    OR: [{ assigneeId: userId }, { assigneeId: null, creatorId: userId }],
  };
  /**
   * **«Degli altri» si scrive per esteso, non come `NOT` delle mie.**
   *
   * In SQL un confronto con `NULL` non è falso: è *ignoto*. `NOT (assigneeId =
   * io OR …)` su un'offerta senza commerciale dava ignoto, e quella riga
   * spariva da tutti e due i lati del filtro — nessuno se ne sarebbe accorto
   * finché non fosse mancata proprio l'offerta che si cercava. L'ha trovata il
   * test che pretende «mie + altrui = tutte» (04/09/2026).
   */
  const altrui: Prisma.TaskWhereInput = {
    OR: [
      // assegnata a qualcun altro (le non assegnate restano fuori da sole)
      { assigneeId: { notIn: [userId] } },
      // non assegnata, ma l'ha aperta un altro
      { assigneeId: null, creatorId: { not: userId } },
    ],
  };
  return owner === "mine" ? mie : altrui;
}

/** Un cliente o un monitor non ha «le proprie» offerte: il filtro non lo riguarda. */
export function haOfferteProprie(role: string): boolean {
  return role !== UserRole.PORTAL && role !== UserRole.SALES_MONITOR;
}
