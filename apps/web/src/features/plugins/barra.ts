// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * La chiave dello stato del bottone di un plugin nella barra. Sta qui, da
 * sola, perché la usano in due che non devono importarsi a vicenda: il bottone
 * (`PluginBarButtons`) e il canale in tempo reale (`useNotifications`), che la
 * invalida quando il plugin manda il suo segnale.
 */
export const chiaveBarra = (nome: string) => ["plugin-barra", nome];
