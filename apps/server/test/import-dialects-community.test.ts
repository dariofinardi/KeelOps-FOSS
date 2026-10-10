// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prepareTestDb } from "./support/test-db";

process.env.KEELOPS_EDITION = "community";
prepareTestDb("import-dialects-community");
const { parseWorkbook } = await import("../src/modules/imports/excel");
const { dialettiImport } = await import("../src/modules/imports/dialects");
const { ruoloRigaTask, significatoStato } = await import("../src/modules/imports/dialects-core");

/**
 * **The community Excel import reads the KeelOps template, and only that**
 * (08/10/2026): no Monday columns, statuses or sub-items. Migrating from
 * other platforms is a professional service.
 */
describe("Excel import, community edition", () => {
  it("has no dialect", () => {
    expect(dialettiImport()).toEqual([]);
    expect(significatoStato("fatto")).toBeUndefined();
  });

  it("a sub-item row is not a task, a titled row is", () => {
    expect(
      ruoloRigaTask({ rowNumber: 1, values: { "sotto elementi": "Ricevuta" }, dateValues: {} }),
    ).toEqual({
      tipo: "salta",
    });
    expect(ruoloRigaTask({ rowNumber: 1, values: { titolo: "IVA" }, dateValues: {} })).toEqual({
      tipo: "attivita",
    });
  });

  it("the KeelOps template is read as in the commercial edition", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Task");
    ws.addRow(["Titolo", "Scadenza", "Stato"]);
    ws.addRow(["Versamento IVA", "16/11/2026", "Da lavorare"]);
    const righe = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(righe.map((r) => r.values)).toEqual([
      { titolo: "Versamento IVA", scadenza: "16/11/2026", stato: "Da lavorare" },
    ]);
  });

  it("Monday's own columns are not recognised", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Monday");
    ws.addRow(["Proprietario", "Ora di inizio", "Tipo di frequenza"]);
    ws.addRow(["Anna", "01/10/2026", "Mensile"]);
    expect(await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual([]);
  });
});
