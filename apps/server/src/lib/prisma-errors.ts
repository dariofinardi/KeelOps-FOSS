// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Il vincolo di unicità violato (`P2002`): il nome doppio, l'email già usata.
 *
 * Le rotte lo traducono in un 409 con una frase di dominio («esiste già un
 * gruppo con questo nome») invece del 500 anonimo. Era copiato identico in sei
 * moduli: la prossima correzione si fa qui, una volta.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
