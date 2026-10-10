// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, randomBytes } from "node:crypto";
import { config } from "../../config";
import { prisma } from "../../db";
import { ruoloPrevisto } from "../../edition/roles";
import { forbidden } from "../../lib/http-errors";

/**
 * Nome distinto in sviluppo: i cookie non sono isolati per porta, quindi dev e
 * produzione sullo stesso host si sovrascriverebbero a vicenda. Peggio, il cookie
 * `Secure` della produzione HTTPS impedisce al dev in HTTP di sostituirlo (RFC 6265bis,
 * "Leave Secure Cookies Alone"): il login riesce ma la sessione non viene mai salvata.
 */
export const SESSION_COOKIE = config.isDev ? "kancrm_session_dev" : "kancrm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni

// In DB salviamo solo lo sha256 del token: un dump del db non consente il replay.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  // Un ruolo che questa edizione non serve (un cliente del portale su una
  // community) non apre sessioni: è il punto da cui passano password, codice
  // via email e Google. Il guardiano lo rifiuterebbe comunque a ogni richiesta.
  const utente = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (utente && !ruoloPrevisto(utente.role)) {
    throw forbidden("Questo tipo di utente non è previsto in questa edizione");
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt },
  });
  return { token, expiresAt };
}

export async function findSessionUser(token: string) {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { id: hashToken(token) } }).catch(() => undefined);
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/** Revoca tutte le sessioni dell'utente tranne quella corrente. */
export async function deleteOtherUserSessions(userId: string, currentToken: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, id: { not: hashToken(currentToken) } },
  });
}

/**
 * Elimina le sessioni scadute. Senza questo restano in tabella per sempre (una
 * sessione scaduta viene rimossa solo se l'utente la ripresenta), con crescita
 * monotona. Chiamato dal cron giornaliero. Ritorna quante ne ha eliminate.
 */
export async function deleteExpiredSessions(now = new Date()): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}
