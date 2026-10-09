import { prisma } from "../../db";
import { locked } from "../../lib/http-errors";
import { sendLockoutAlertEmail } from "../mail/service";

/**
 * **Il freno progressivo sulle password sbagliate** (richiesta del 05/09/2026).
 *
 * Il limitatore per IP del login ferma chi martella da fuori; questo ferma chi
 * prova a indovinare la password di **una persona**, da qualunque posto e con
 * qualunque sessione — vale per l'accesso e per il cambio password, che chiede
 * la password attuale ed era un oracolo senza limite (V4 di PLAN_OPTIMIZE).
 *
 * La regola: i primi due errori non costano niente (si sbaglia a digitare);
 * dal **terzo** l'account si chiude per 30 secondi, e ogni errore successivo
 * raddoppia l'attesa — 60 s, 2, 4, 8, 16, 32, 64 minuti — fino al tetto di
 * **100 minuti**. Al terzo errore parte un'email agli amministratori, una sola
 * per episodio. Una password giusta azzera tutto; un amministratore può
 * azzerare da «Utenti», oltre a reimpostare la password.
 */
export const LOCK_AFTER = 3;
export const LOCK_FIRST_SECONDS = 30;
export const LOCK_CAP_SECONDS = 100 * 60;

/** Quanti secondi di chiusura dopo `failures` errori consecutivi (0 = nessuna). */
export function lockSeconds(failures: number): number {
  if (failures < LOCK_AFTER) return 0;
  return Math.min(LOCK_FIRST_SECONDS * 2 ** (failures - LOCK_AFTER), LOCK_CAP_SECONDS);
}

/** L'attesa rimasta, come la si dice a chi aspetta: secondi sotto il minuto, minuti sopra. */
export function attesa(until: Date, now: Date): { chiave: string; n: number } {
  const secondi = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
  return secondi < 60
    ? { chiave: "Troppi tentativi: riprova fra {{n}} secondi", n: secondi }
    : { chiave: "Troppi tentativi: riprova fra {{n}} minuti", n: Math.ceil(secondi / 60) };
}

type Bloccabile = { passwordLockedUntil: Date | null };

/** Rifiuta con 423 finché la chiusura non è passata; non conta come tentativo. */
export function assertNotLocked(user: Bloccabile, now = new Date()): void {
  if (user.passwordLockedUntil && user.passwordLockedUntil > now) {
    const { chiave, n } = attesa(user.passwordLockedUntil, now);
    throw locked(chiave, { n });
  }
}

/**
 * Registra una password sbagliata: incrementa, calcola la chiusura, e al
 * terzo errore avvisa gli amministratori (una volta per episodio). Torna lo
 * stato nuovo, così chi chiama può metterlo nel log.
 */
export async function registerFailedPassword(
  userId: string,
  now = new Date(),
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const dopo = await prisma.user.update({
    where: { id: userId },
    data: { failedPasswordAttempts: { increment: 1 } },
    select: {
      id: true,
      name: true,
      email: true,
      failedPasswordAttempts: true,
      lockoutAlertedAt: true,
    },
  });
  const secondi = lockSeconds(dopo.failedPasswordAttempts);
  const lockedUntil = secondi > 0 ? new Date(now.getTime() + secondi * 1000) : null;
  const avvisare = dopo.failedPasswordAttempts >= LOCK_AFTER && !dopo.lockoutAlertedAt;
  await prisma.user.update({
    where: { id: userId },
    data: { passwordLockedUntil: lockedUntil, ...(avvisare ? { lockoutAlertedAt: now } : {}) },
  });
  if (avvisare) {
    // Best-effort: la posta spenta o guasta non cambia il freno.
    void sendLockoutAlertEmail(dopo, dopo.failedPasswordAttempts, lockedUntil).catch((err) =>
      console.warn(`[lockout] avviso agli amministratori non partito: ${(err as Error).message}`),
    );
  }
  return { attempts: dopo.failedPasswordAttempts, lockedUntil };
}

/** Password giusta, o azzeramento da parte di un amministratore. */
export async function clearPasswordLock(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedPasswordAttempts: 0, passwordLockedUntil: null, lockoutAlertedAt: null },
  });
}
