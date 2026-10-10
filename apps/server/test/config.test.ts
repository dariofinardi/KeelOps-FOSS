// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { envSchema } from "../src/config";

describe("validazione env (B1)", () => {
  it("applica i default quando le variabili non sono impostate", () => {
    const env = envSchema.parse({});
    expect(env.PORT).toBe(3001);
    expect(env.BACKUP_RETENTION_DAYS).toBe(30);
    expect(env.TRASH_RETENTION_DAYS).toBe(30);
    expect(env.MAX_UPLOAD_MB).toBe(80);
  });

  it("accetta valori numerici validi (stringhe da process.env)", () => {
    const env = envSchema.parse({ PORT: "8080", BACKUP_RETENTION_DAYS: "7" });
    expect(env.PORT).toBe(8080);
    expect(env.BACKUP_RETENTION_DAYS).toBe(7);
  });

  it("rifiuta valori malformati invece di produrre NaN", () => {
    expect(envSchema.safeParse({ BACKUP_RETENTION_DAYS: "trenta" }).success).toBe(false);
    expect(envSchema.safeParse({ PORT: "abc" }).success).toBe(false);
    expect(envSchema.safeParse({ MAX_UPLOAD_MB: "-5" }).success).toBe(false);
    expect(envSchema.safeParse({ TRASH_RETENTION_DAYS: "0" }).success).toBe(false);
  });
});
