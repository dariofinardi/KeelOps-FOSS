// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { UserRole } from "@kancrm/shared";
import { emailPuoPartire } from "./weekend";

/**
 * **Che fare dell'email di un avviso in coda** (25/09/2026).
 *
 * Nessuna email parte più nel momento dell'avviso: aspetta qualche minuto
 * (`EMAIL_GRACE_MINUTES`, 15 di serie) e, se nel frattempo l'avviso è stato
 * **letto nella campanella**, non parte affatto. Chi ha già visto la cosa
 * lavorando non ha bisogno di ritrovarsela in posta — lo ha chiesto un utente:
 * «se ho letto la notifica da ui la mail non importa».
 *
 * La regola sta qui, pura, perché la usano due giri diversi — quello delle
 * email singole, ogni minuto, e quello dei riepiloghi — e scritta due volte
 * divergerebbe al primo ritocco.
 *
 * - `scarta`: l'avviso è stato letto; l'email non serve più.
 * - `aspetta`: è weekend per chi non le vuole allora, oppure l'attesa non è
 *   ancora passata.
 * - `riepilogo`: la porta via il riepilogo — chi ha chiesto le email aggregate,
 *   e gli avvisi trattenuti nel weekend, che il lunedì arrivano insieme come
 *   prima.
 * - `singola`: parte adesso, da sola.
 */
export type DestinoEmail = "scarta" | "aspetta" | "riepilogo" | "singola";

export function destinoEmail(
  avviso: { readAt: Date | null; inApp: boolean; createdAt: Date },
  destinatario: { emailDigest: boolean; emailWeekend: boolean; role?: string } | null | undefined,
  now: Date,
  attesaMinuti: number,
): DestinoEmail {
  // Il portale clienti resta com'era (25/09/2026): in coda ci finisce solo per
  // il riepilogo o per il weekend, e lì niente scarto né attesa.
  if (destinatario?.role === UserRole.PORTAL) {
    if (!emailPuoPartire(destinatario, now)) return "aspetta";
    return "riepilogo";
  }
  if (avviso.readAt) return "scarta";
  if (!emailPuoPartire(destinatario, now)) return "aspetta";
  // Il tempo per leggerlo nella campanella — anche per chi aggrega. Chi l'ha
  // spenta per questo tipo non lo leggerà mai lì: per lui niente attesa.
  const giovane = now.getTime() - avviso.createdAt.getTime() < attesaMinuti * 60_000;
  if (avviso.inApp && giovane) return "aspetta";
  if (destinatario?.emailDigest) return "riepilogo";
  // Nato quando l'email non poteva partire (il weekend): si unisce agli altri
  // trattenuti, e il lunedì arriva un'email sola, non una per avviso.
  if (!emailPuoPartire(destinatario, avviso.createdAt)) return "riepilogo";
  return "singola";
}
