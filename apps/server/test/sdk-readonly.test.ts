// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { readOnlyQuery } from "../../../plugins/keelops-sdk/database.mjs";

/**
 * **La connessione, non il testo, è la barriera** (V3): le letture di un
 * plugin passano da un accesso al file aperto in sola lettura, e una
 * scrittura che il cancello sul testo non avesse riconosciuto la rifiuta
 * SQLite stesso.
 */
const cartella = mkdtempSync(path.join(os.tmpdir(), "keelops-ro-"));
const file = path.join(cartella, "prova.db");
const db = new DatabaseSync(file);
db.exec(
  "CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO t (nome) VALUES ('a'), ('b')",
);
db.close();
afterAll(() => rmSync(cartella, { recursive: true, force: true }));

describe("readOnlyQuery", () => {
  const query = readOnlyQuery(file);

  it("legge, con i parametri posizionali", async () => {
    expect(await query("SELECT nome FROM t WHERE id > ? ORDER BY id", [1])).toEqual([
      { nome: "b" },
    ]);
  });

  it("una scrittura la rifiuta il file, qualunque forma abbia", async () => {
    await expect(async () => query("DELETE FROM t", [])).rejects.toThrow(/readonly/i);
    await expect(async () =>
      query("WITH x AS (SELECT 1) INSERT INTO t (nome) VALUES ('c')", []),
    ).rejects.toThrow(/readonly/i);
    expect(await query("SELECT COUNT(*) AS n FROM t", [])).toEqual([{ n: 2 }]);
  });
});
