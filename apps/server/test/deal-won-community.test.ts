// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

process.env.KEELOPS_EDITION = "community";
prepareTestDb("deal-won-community");
const { vinciUnOfferta } = await import("./support/deal-won-scenario");

/**
 * **L'offerta vinta nella community** (08/10/2026): nessun modulo legge i
 * contratti, e il nucleo fa quello che ha sempre fatto senza modello — il task
 * di fatturazione, subito. La risposta non parla di nessuna lettura.
 */
describe("offerta vinta, edizione community", () => {
  it("nasce il task di fatturazione, senza lettura", async () => {
    expect(await vinciUnOfferta()).toEqual({
      status: 200,
      analysisState: null,
      analysisNotice: null,
      taskDiFatturazione: 1,
    });
  });
});
