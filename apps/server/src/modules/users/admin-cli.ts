// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { UserRole } from "@kancrm/shared";
import { prisma } from "../../db";
import { hashPassword } from "../auth/password";
import { deleteAllUserSessions } from "../auth/session";

/**
 * Operazioni di servizio da riga di comando, per chi amministra la macchina.
 *
 * Esistono perché una password si può perdere anche quando non c'è nessun
 * amministratore in grado di entrare — il caso limite in cui l'interfaccia non
 * aiuta più. Chi ha la shell sul server ha già accesso al database e ai file:
 * questo strumento non aggiunge potere, gli dà una strada pulita invece di
 * `UPDATE User SET ...` scritti a mano, che sbaglierebbero l'hash.
 *
 * La logica sta qui e non nello script perché così si può provare: lo script
 * (`scripts/utenti.ts`) legge gli argomenti e stampa, nient'altro.
 */

/** Password assegnata da un reset: va cambiata al primo accesso. */
export const DEFAULT_RESET_PASSWORD = "Ch4ng3m3%";

export interface UserRow {
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
}

/** Utenti in ordine di ultimo accesso: chi manca da più tempo emerge da solo. */
export async function listUsers(): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    where: { isSystem: false },
    select: {
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      lastSeenAt: true,
    },
  });
  return users.sort((a, b) => {
    // Mai entrati in fondo: sono il caso da guardare, non il più recente.
    if (!a.lastLoginAt && !b.lastLoginAt) return a.name.localeCompare(b.name, "it");
    if (!a.lastLoginAt) return 1;
    if (!b.lastLoginAt) return -1;
    return b.lastLoginAt.getTime() - a.lastLoginAt.getTime();
  });
}

export interface ResetOutcome {
  email: string;
  name: string;
  password: string;
  /** Sessioni chiuse dal reset: chi era collegato viene fatto uscire. */
  closedSessions: number;
}

/**
 * Riscrive la password di un utente e **chiude le sue sessioni**: se qualcuno
 * era dentro con le vecchie credenziali (l'ipotesi per cui si fa un reset
 * d'emergenza), da quel momento è fuori.
 *
 * L'hash lo calcola la stessa funzione dell'applicazione, quindi con il pepe se
 * è configurato: una password scritta a mano nel database non funzionerebbe.
 *
 * La password è **provvisoria** come quella del reset dalla pagina Utenti: la
 * sceglie qualcun altro e si comunica a voce, quindi al primo accesso
 * l'applicazione ne chiede una propria. Prima era una raccomandazione stampata
 * a schermo, che valeva quanto la memoria di chi la leggeva.
 */
export async function resetUserPassword(
  email: string,
  password: string = DEFAULT_RESET_PASSWORD,
): Promise<ResetOutcome> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`Nessun utente con indirizzo "${email}"`);
  if (user.isSystem) throw new Error("L'utente di sistema non ha un accesso da reimpostare");

  const closedSessions = await prisma.session.count({ where: { userId: user.id } });
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  await deleteAllUserSessions(user.id);
  return { email: user.email, name: user.name, password, closedSessions };
}

export interface CreateAdminOutcome {
  email: string;
  name: string;
  password: string;
}

/** Una password provvisoria leggibile a voce: niente caratteri che si confondono (0/O, 1/l). */
export function provisionalPassword(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const byte = randomBytes(12);
  const corpo = Array.from(byte, (b) => alfabeto[b % alfabeto.length]).join("");
  return `${corpo.slice(0, 4)}-${corpo.slice(4, 8)}-${corpo.slice(8, 12)}`;
}

/**
 * **Il primo amministratore di un'istanza nuova** (02/10/2026). Un database
 * appena creato non ha utenti, e senza un amministratore nessuno entra a
 * crearne: è il caso in cui l'interfaccia non può aiutare. Chi ha la shell sul
 * server lo crea da qui (`nuova-istanza.sh` lo fa da sé).
 *
 * La password è **provvisoria** e casuale, come quella di un reset: si comunica
 * a voce e al primo accesso l'applicazione ne chiede una propria. Se l'utente
 * esiste già non si tocca niente: per una password persa c'è `reset`.
 */
export async function createAdmin(
  email: string,
  name: string,
  password: string = provisionalPassword(),
): Promise<CreateAdminOutcome> {
  const indirizzo = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(indirizzo)) {
    throw new Error(`"${email}" non sembra un indirizzo email`);
  }
  if (await prisma.user.findUnique({ where: { email: indirizzo } })) {
    throw new Error(`Esiste già un utente con indirizzo "${indirizzo}": per la password usa reset`);
  }
  // Nel gruppo di tutti, se la struttura c'è: come chi nasce dalla pagina Utenti.
  const tutti = await prisma.group.findUnique({ where: { name: "Tutti" } });
  await prisma.user.create({
    data: {
      email: indirizzo,
      name: name.trim() || indirizzo,
      role: UserRole.ADMIN,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      locale: "auto",
      ...(tutti ? { groups: { create: [{ groupId: tutti.id }] } } : {}),
    },
  });
  return { email: indirizzo, name: name.trim() || indirizzo, password };
}
