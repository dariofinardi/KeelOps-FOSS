// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { FUNZIONI_DEL_NUCLEO, VisibilityScope, type CurrentUser } from "@kancrm/shared";
import { useCurrentUser } from "@/features/auth/useAuth";
import { edizione } from "@/edition/rotte";

/**
 * **Le funzioni dell'istanza, lato web** (17/10/2026): l'amministratore può
 * spegnere un'area del nucleo o un modulo dell'edizione, e l'elenco delle
 * spente arriva con l'utente (`funzioniSpente`). Il server chiude le rotte da
 * sé; qui si nasconde ciò che porterebbe a un 404. Vedi
 * `plan/funzioni-istanza.md`.
 */
export function funzioneAccesa(user: Pick<CurrentUser, "funzioniSpente">, chiave: string): boolean {
  // Un utente senza l'elenco (un server di prima del 17/10/2026, un utente
  // finto nei test) ha tutto acceso: è lo stato di partenza di ogni installazione.
  const spente = (user.funzioniSpente as readonly string[] | undefined) ?? [];
  return !spente.includes(chiave);
}

/** Un modulo dell'edizione c'è **e** è acceso in questa installazione. */
export function moduloAcceso(user: Pick<CurrentUser, "funzioniSpente">, nome: string): boolean {
  return edizione.moduli.has(nome) && funzioneAccesa(user, nome);
}

export function useFunzioneAccesa(chiave: string): boolean {
  return funzioneAccesa(useCurrentUser(), chiave);
}

export function useModuloAcceso(nome: string): boolean {
  return moduloAcceso(useCurrentUser(), nome);
}

/**
 * La funzione che porta ciascuno scope di gruppo: le aree del nucleo dal
 * catalogo condiviso, i ticket dal loro modulo.
 */
const FUNZIONE_DELLO_SCOPE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    FUNZIONI_DEL_NUCLEO.flatMap((f) => (f.scope ? [[f.scope, f.chiave] as const] : [])),
  ),
  [VisibilityScope.TICKETS]: "ticket",
};

/**
 * Lo scope di gruppo esiste in questa installazione: la sua area è accesa (e,
 * per un modulo, l'edizione lo porta). Uno scope senza area non si offre.
 */
export function scopeAcceso(user: Pick<CurrentUser, "funzioniSpente">, scope: string): boolean {
  const funzione = FUNZIONE_DELLO_SCOPE[scope];
  if (!funzione) return true;
  return FUNZIONI_DEL_NUCLEO.some((f) => f.chiave === funzione)
    ? funzioneAccesa(user, funzione)
    : moduloAcceso(user, funzione);
}
