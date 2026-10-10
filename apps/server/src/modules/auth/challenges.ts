// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "../../db";
import type { User } from "../../generated/prisma/client";

/**
 * Le sfide di accesso via email: il reset password self-service e i codici
 * OTP. Un'unica tabella (`AuthChallenge`) e un'unica disciplina:
 *
 *  - il segreto (token o codice) viaggia SOLO nell'email; in tabella sta la
 *    sua impronta sha256, con un prefisso per tipo — come le sessioni, il
 *    database non contiene nulla di spendibile;
 *  - vita breve (30' il reset, 10' il codice), un solo uso, una sola sfida
 *    attiva per persona e tipo;
 *  - i tentativi si contano e al quinto la sfida muore: un codice di sei
 *    cifre regge solo se non si può tirare a indovinare;
 *  - il ritmo si tiene: una nuova email per lo stesso tipo non parte se
 *    l'ultima ha meno di un minuto — e chi chiama risponde SEMPRE la stessa
 *    cosa, esista o no l'utente: da fuori non si enumera nessuno.
 */
export const ChallengeType = {
  RESET_PASSWORD: "RESET_PASSWORD",
  EMAIL_OTP: "EMAIL_OTP",
  /** Sblocco di un messaggio riservato (@secret): stessa meccanica del login
   *  via codice, sfida separata — un codice di login non apre un messaggio. */
  UNLOCK_OTP: "UNLOCK_OTP",
} as const;
export type ChallengeType = (typeof ChallengeType)[keyof typeof ChallengeType];

const RESET_TTL_MS = 30 * 60_000;
const OTP_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const fingerprint = (type: ChallengeType, secret: string): string =>
  createHash("sha256").update(`${type}:${secret}`).digest("hex");

async function replaceChallenge(
  userId: string,
  type: ChallengeType,
  id: string,
  ttlMs: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.authChallenge.deleteMany({ where: { userId, type } }),
    prisma.authChallenge.create({
      data: { id, userId, type, expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
}

/** C'è una sfida di questo tipo spedita da meno di un minuto? Allora non se ne manda un'altra. */
export async function inCooldown(userId: string, type: ChallengeType): Promise<boolean> {
  const last = await prisma.authChallenge.findFirst({
    where: { userId, type, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  return last !== null;
}

/** Crea la sfida di reset e restituisce il token da mettere nel link (mai salvato). */
export async function createResetChallenge(user: User): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await replaceChallenge(user.id, ChallengeType.RESET_PASSWORD,
    fingerprint(ChallengeType.RESET_PASSWORD, token), RESET_TTL_MS);
  return token;
}

/** Consuma il token di reset: l'utente se è buono, null se scaduto/ignoto/già usato. */
export async function consumeResetChallenge(token: string): Promise<User | null> {
  const id = fingerprint(ChallengeType.RESET_PASSWORD, token);
  const challenge = await prisma.authChallenge.findUnique({ where: { id }, include: { user: true } });
  if (!challenge) return null;
  await prisma.authChallenge.delete({ where: { id } }).catch(() => undefined);
  if (challenge.expiresAt < new Date() || !challenge.user.isActive) return null;
  return challenge.user;
}

/** Crea la sfida OTP e restituisce il codice a sei cifre da spedire (mai salvato). */
export async function createOtpChallenge(
  user: User,
  type: ChallengeType = ChallengeType.EMAIL_OTP,
): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await replaceChallenge(user.id, type, fingerprint(type, `${user.id}:${code}`), OTP_TTL_MS);
  return code;
}

/**
 * Verifica il codice OTP. Il fallimento CONSUMA un tentativo sulla sfida
 * attiva dell'utente (qualunque sia: il codice sbagliato non la identifica),
 * e al quinto la sfida muore.
 */
export async function verifyOtpChallenge(
  user: User,
  code: string,
  type: ChallengeType = ChallengeType.EMAIL_OTP,
): Promise<boolean> {
  const id = fingerprint(type, `${user.id}:${code}`);
  const challenge = await prisma.authChallenge.findUnique({ where: { id } });
  if (challenge && challenge.expiresAt >= new Date() && challenge.attempts < MAX_ATTEMPTS) {
    await prisma.authChallenge.delete({ where: { id } }).catch(() => undefined);
    return true;
  }
  await prisma.authChallenge.updateMany({
    where: { userId: user.id, type },
    data: { attempts: { increment: 1 } },
  });
  await prisma.authChallenge.deleteMany({
    where: { userId: user.id, type, attempts: { gte: MAX_ATTEMPTS } },
  });
  return false;
}

/** Pulizia notturna: le sfide scadute non servono a nessuno. */
export async function sweepExpiredChallenges(): Promise<number> {
  const swept = await prisma.authChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return swept.count;
}
