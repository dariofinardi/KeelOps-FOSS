// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODELLI_IN_ORDINE } from "../scripts/mariadb/modelli";
import { OLTRE_IL_LIMITE, TIPI_MARIADB } from "../scripts/mariadb/tipi";

/**
 * Gli strumenti della migrazione a MariaDB non hanno un database sotto: quello
 * che si può provare senza, e che conta, è che **non restino indietro rispetto
 * allo schema**. Un modello aggiunto e non travasato, o un campo rinominato che
 * lascia un tipo orfano, si scoprirebbero a dati mancanti — mesi dopo, e su
 * dati veri.
 */
const schema = readFileSync(path.resolve(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
const modelliDelloSchema = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
/** Prisma espone i modelli in minuscolo iniziale: `TaskTag` → `taskTag`. */
const comeDelegato = (nome: string) => nome[0]!.toLowerCase() + nome.slice(1);

describe("il kit di migrazione a MariaDB segue lo schema", () => {
  it("travasa tutti i modelli, senza inventarne", () => {
    const attesi = modelliDelloSchema.map(comeDelegato).sort();
    expect([...MODELLI_IN_ORDINE].sort()).toEqual(attesi);
  });

  it("i tipi MariaDB si riferiscono a campi che esistono davvero", () => {
    for (const chiave of Object.keys(TIPI_MARIADB)) {
      const [modello, campo] = chiave.split(".") as [string, string];
      expect(modelliDelloSchema, `modello di ${chiave}`).toContain(modello);
      const corpo =
        new RegExp(`^model ${modello} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
      expect(corpo, `campo ${chiave}`).toMatch(new RegExp(`^\\s+${campo}\\s+String`, "m"));
    }
  });

  it("ogni colonna che in produzione supera i 191 caratteri ha il suo tipo", () => {
    // Misurate sui dati veri il 01/09/2026: senza un tipo esplicito MySQL le
    // taglierebbe a 191 senza dire niente.
    for (const chiave of OLTRE_IL_LIMITE) {
      expect(Object.keys(TIPI_MARIADB), chiave).toContain(chiave);
    }
  });

  it("i tipi lunghi non finiscono su campi indicizzati, che MySQL non sa indicizzare", () => {
    // TEXT/LONGTEXT non stanno in un indice senza prefisso: se un campo è
    // @unique o compare in @@index/@@unique deve restare VarChar.
    for (const [chiave, tipo] of Object.entries(TIPI_MARIADB)) {
      if (!tipo.includes("Text")) continue;
      const [modello, campo] = chiave.split(".") as [string, string];
      const corpo =
        new RegExp(`^model ${modello} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
      const riga = new RegExp(`^\\s+${campo}\\s+String[^\\n]*`, "m").exec(corpo)?.[0] ?? "";
      expect(riga, `${chiave} è unico: non può essere ${tipo}`).not.toMatch(/@unique/);
      expect(corpo, `${chiave} è indicizzato: non può essere ${tipo}`).not.toMatch(
        new RegExp(`@@(index|unique)\\(\\[[^\\]]*\\b${campo}\\b`),
      );
    }
  });
});
