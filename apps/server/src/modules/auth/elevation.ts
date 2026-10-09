import { UserRole } from "@kancrm/shared";
import type { User } from "../../generated/prisma/client";

/**
 * Privilegi di amministratore **a richiesta**, come `sudo`.
 *
 * Un admin lavora normalmente con gli occhi di un utente qualunque — vede
 * l'applicazione come la vedono i colleghi, e non può rompere niente per
 * distrazione — e si eleva solo quando deve davvero: la pagina Utenti, gli
 * stati, il cestino. L'elevazione **scade da sé** (30 minuti): restare admin
 * per settimane senza accorgersene vanificherebbe la funzione.
 *
 * Il meccanismo è tutto qui e in un punto solo del guard di autenticazione
 * (`plugins/auth`): il ruolo che il resto dell'applicazione legge è già quello
 * **efficace**. Permessi, perimetri, menù e viste non sanno nulla di questa
 * funzione e continuano a fare `role === ADMIN` come hanno sempre fatto.
 */

/** Quanto dura un'elevazione: abbastanza per un giro di configurazione. */
export const ELEVATION_MINUTES = 30;

/** Un admin sta usando i suoi privilegi adesso? */
export function isElevated(
  user: { role: string; adminUntil: Date | null },
  now = new Date(),
): boolean {
  if (user.role !== UserRole.ADMIN) return false;
  return user.adminUntil !== null && user.adminUntil > now;
}

/** Chi PUÒ elevarsi (il ruolo vero in banca dati), elevato o no in questo momento. */
export function canElevate(user: { role: string }): boolean {
  return user.role === UserRole.ADMIN;
}

/**
 * L'utente come lo vede il resto dell'applicazione: un admin non elevato è un
 * MEMBER a tutti gli effetti. Copia, mai modifica sul posto: l'oggetto arriva
 * dalla sessione e il ruolo vero serve ancora a chi decide sull'elevazione.
 */
export function effectiveUser(user: User, now = new Date()): User {
  if (user.role !== UserRole.ADMIN || isElevated(user, now)) return user;
  return { ...user, role: UserRole.MEMBER };
}

/** Scadenza di una nuova elevazione. */
export function elevationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ELEVATION_MINUTES * 60_000);
}
