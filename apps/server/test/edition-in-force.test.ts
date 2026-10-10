// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

/**
 * **The exported community tree is the community** (08/10/2026). There
 * `commercial/` is a stub with no modules, and the edition must say so even
 * when `KEELOPS_EDITION` is missing or still says `commerciale` (a `.env` copied
 * from a commercial installation): plugins read it from `ctx.edizione`.
 */
vi.mock("../src/commercial", () => ({ MODULI_COMMERCIALI: [] }));
process.env.KEELOPS_EDITION = "commerciale";

const { edizioneInVigore, moduliAttivi } = await import("../src/edition/registry");
const { config } = await import("../src/config");

describe("the edition in force without commercial modules", () => {
  it("is the community, whatever the configuration says", () => {
    expect(config.edizione).toBe("commerciale");
    expect(edizioneInVigore()).toBe("community");
    expect(moduliAttivi()).toEqual([]);
  });
});
