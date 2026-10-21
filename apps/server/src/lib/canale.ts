// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * **Da dove arriva una modifica** (21/10/2026): l'applicazione, o un plugin che
 * scrive a nome di una persona — un assistente collegato con MCP crea
 * un'offerta per Maria, e la cronologia deve dire «Maria Rossi via MCP», non
 * solo «Maria Rossi».
 *
 * Il canale lo mette la porta del plugin (`plugins/plugin-crm.ts`) attorno
 * alla chiamata, e lo legge `logActivity`: nessuna funzione in mezzo deve
 * saperlo né passarlo. Fuori da un canale, niente cambia.
 */
const storage = new AsyncLocalStorage<string>();

/** Esegue `fn` con le modifiche marcate come arrivate da `canale`. */
export function conCanale<T>(canale: string, fn: () => T): T {
  return storage.run(canale, fn);
}

/** Il canale della modifica in corso, o null se arriva dall'applicazione. */
export function canaleCorrente(): string | null {
  return storage.getStore() ?? null;
}
