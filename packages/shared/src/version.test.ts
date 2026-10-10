// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

/**
 * La versione è scritta in due posti (la costante che l'applicazione mostra e i
 * package.json del monorepo): questo test è ciò che impedisce loro di divergere,
 * cioè di mostrare in produzione una versione che non è quella rilasciata.
 */
describe("APP_VERSION", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const versionOf = (pkg: string): string =>
    (JSON.parse(readFileSync(path.join(root, pkg, "package.json"), "utf8")) as { version: string })
      .version;

  it("è la stessa dei package.json del monorepo", () => {
    for (const pkg of [".", "apps/server", "apps/web", "packages/shared"]) {
      expect(versionOf(pkg), `versione di ${pkg}`).toBe(APP_VERSION);
    }
  });

  it("ha la forma major.minor.patch", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
