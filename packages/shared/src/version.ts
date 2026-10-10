// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Versione di KeelOps, unica per tutto il monorepo. Si alza a ogni rilascio in
 * produzione (l'ultimo numero a ogni deploy) e deve restare allineata ai
 * `package.json`: c'è un test che lo verifica, così non si scollano.
 *
 * Serve a rispondere alla domanda "cosa c'è in produzione adesso?": la mostrano
 * `/api/health` e la pagina Sistema.
 */
export const APP_VERSION = "0.12.67";
