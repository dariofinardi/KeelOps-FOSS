// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  hasReservedToken,
  hasUserToken,
  stripReservedToken,
  stripUserToken,
} from "../src/modules/tasks/chat-keywords";

/**
 * `@user` è un comando, non una parola del messaggio: si riconosce come tale e
 * sparisce dal testo che il cliente legge.
 */
describe("la parola chiave @user", () => {
  it("si riconosce all'inizio, in mezzo e con la punteggiatura", () => {
    expect(hasUserToken("@user ti confermo che è risolto")).toBe(true);
    expect(hasUserToken("ecco, @user: ci siamo")).toBe(true);
    expect(hasUserToken("@USER anche in maiuscolo")).toBe(true);
  });

  it("non si confonde con una parola che le somiglia", () => {
    expect(hasUserToken("il campo @username non c'entra")).toBe(false);
    expect(hasUserToken("scrivi a user@example.com")).toBe(false);
    expect(hasUserToken("nessun comando qui")).toBe(false);
  });

  it("sparisce dal testo, senza mangiarsi il resto", () => {
    expect(stripUserToken("@user ti confermo che è risolto")).toBe("ti confermo che è risolto");
    expect(stripUserToken("ecco, @user: ci siamo")).toBe("ecco, ci siamo");
    expect(stripUserToken("niente da togliere")).toBe("niente da togliere");
  });
});

/**
 * `@reserved` tiene il messaggio fra colleghi: stessa grammatica di `@user`,
 * e come lui sparisce dal testo salvato (16/09/2026).
 */
describe("la parola chiave @reserved", () => {
  it("si riconosce all'inizio, in mezzo e con la punteggiatura", () => {
    expect(hasReservedToken("@reserved lo guardo io")).toBe(true);
    expect(hasReservedToken("nota: @reserved, non dirlo al cliente")).toBe(true);
    expect(hasReservedToken("@RESERVED in maiuscolo")).toBe(true);
  });

  it("non si confonde con una parola che le somiglia", () => {
    expect(hasReservedToken("il campo @reservedAt non c'entra")).toBe(false);
    expect(hasReservedToken("scrivi a reserved@example.com")).toBe(false);
    expect(hasReservedToken("posto reserved in sala")).toBe(false);
  });

  it("sparisce dal testo, senza mangiarsi il resto", () => {
    expect(stripReservedToken("@reserved lo guardo io")).toBe("lo guardo io");
    expect(stripReservedToken("nota: @reserved, non dirlo")).toBe("nota: non dirlo");
    expect(stripReservedToken("niente da togliere")).toBe("niente da togliere");
  });
});
