// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Informazioni fissate al momento della build. `__WEB_VERSIONS__` lo sostituisce
 * Vite (vedi `vite.config.ts`); sotto test quel valore non esiste, e allora
 * l'elenco è semplicemente vuoto.
 */
declare const __WEB_VERSIONS__: Array<{ name: string; version: string }> | undefined;

export const WEB_VERSIONS: Array<{ name: string; version: string }> =
  typeof __WEB_VERSIONS__ === "undefined" ? [] : __WEB_VERSIONS__;
