// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ModuloEdizione } from "../edition/registry";

/**
 * The community edition has no commercial modules: the registry finds an empty
 * list and the core runs on its own.
 */
export const MODULI_COMMERCIALI: readonly ModuloEdizione[] = [];
