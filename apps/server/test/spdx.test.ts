// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Every source file says its licence** (10/10/2026): a copyright line and an
 * SPDX identifier in the first lines, so that a file copied out of the tree
 * still tells where it comes from and under which terms. Which identifier is a
 * matter of edition and of the file; here only that it is there.
 */
const RADICE = path.resolve(import.meta.dirname, "../../..");
const SALTA = new Set(["node_modules", "generated", "dist", "public"]);

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (SALTA.has(nome) || nome.startsWith(".")) continue;
    const pieno = path.join(dir, nome);
    // lstat: the commercial plugins are symbolic links to another repository.
    const st = lstatSync(pieno);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) sorgenti(pieno, out);
    else if (/\.(ts|tsx|mjs|js|css)$/.test(nome) && !nome.endsWith(".d.ts")) out.push(pieno);
  }
  return out;
}

describe("SPDX headers", () => {
  it("every source file in apps, packages and plugins carries copyright and SPDX", () => {
    const senza: string[] = [];
    for (const dir of ["apps", "packages", "plugins", "e2e"]) {
      for (const file of sorgenti(path.join(RADICE, dir))) {
        const testa = readFileSync(file, "utf8").split("\n").slice(0, 4).join("\n");
        if (
          !testa.includes("Copyright (c) 2026 Jugaad s.r.l.") ||
          !testa.includes("SPDX-License-Identifier:")
        )
          senza.push(path.relative(RADICE, file));
      }
    }
    expect(senza).toEqual([]);
  });
});
