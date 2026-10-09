// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { EdizioneWeb } from "../rotte";

/** The community edition: no module, no extra route, no dedicated app for a role. */
export const EDIZIONE_COMMERCIALE: EdizioneWeb = {
  moduli: new Set(),
  rotte: [],
  appPerRuolo: {},
};
