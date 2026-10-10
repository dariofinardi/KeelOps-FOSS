// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chi "lavora il CRM": l'anagrafica clienti si modifica, si elimina e si annota
 * solo da qui. Predicato puro, condiviso: il server lo usa per autorizzare, il
 * client per non mostrare pulsanti che risponderebbero 403.
 *
 * Creare un'azienda resta invece aperto a ogni utente interno — serve a
 * collegare un cliente a un progetto senza passare dal CRM.
 */
export function canManageCompanies(user: {
  role: string;
  canSeeContacts: boolean;
  canSeeDeals: boolean;
}): boolean {
  return user.role === "ADMIN" || user.canSeeContacts || user.canSeeDeals;
}

/**
 * Chi può **arrivare** all'elenco delle offerte: chi ha il modulo, e anche chi
 * ha solo la lente "giornate" (gli sviluppatori, che vedono il carico in
 * giornate senza importi, link né allegati). Serve al menù, alla rotta e ai
 * contatori delle schede cliente: un numero che porta a una pagina vietata è
 * peggio di un numero assente.
 *
 * Attenzione: *arrivare* non è *vedere tutto*. I dettagli commerciali (importi,
 * fasi, offerte collegate in scheda) restano a chi ha il modulo pieno.
 */
export function canReachDeals(user: { canSeeDeals: boolean; dealsDaysView: boolean }): boolean {
  return user.canSeeDeals || user.dealsDaysView;
}
