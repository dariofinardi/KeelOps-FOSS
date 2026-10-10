// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TaskKind } from "./enums";
import {
  TASK_FIELD_GROUPS,
  allClassifiedTaskFields,
  fieldsForKind,
  isFieldForKind,
  kindsForField,
} from "./task-kind-fields";

/**
 * La mappa campi-per-kind vale solo se non può mentire: qui si legge lo
 * schema Prisma vero e si pretende la copertura ESATTA — ogni colonna di Task
 * in esattamente un gruppo. Una colonna nuova non classificata, o un campo
 * inventato, fermano la build.
 */
function taskColumnsFromSchema(): string[] {
  const schema = readFileSync(
    path.resolve(import.meta.dirname, "../../../apps/server/prisma/schema.prisma"),
    "utf8",
  );
  const model = /^model Task \{(.*?)^\}/ms.exec(schema);
  expect(model).not.toBeNull();
  const columns: string[] = [];
  for (const line of model![1]!.split("\n")) {
    const field = /^\s*(\w+)\s+(\S+)/.exec(line);
    if (!field) continue;
    const [, name, type] = field;
    // le liste e i tipi-modello sono relazioni, non colonne
    if (type!.includes("[]")) continue;
    if (/^[A-Z]/.test(type!.replace("?", "")) &&
        !["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes"]
          .includes(type!.replace("?", ""))) continue;
    columns.push(name!);
  }
  return columns;
}

describe("la mappa campi-per-kind", () => {
  it("copre ESATTAMENTE le colonne di Task nello schema, una volta ciascuna", () => {
    const claimed = allClassifiedTaskFields();
    expect(new Set(claimed).size, "un campo sta in un solo gruppo").toBe(claimed.length);
    expect([...claimed].sort()).toEqual([...taskColumnsFromSchema()].sort());
  });

  it("ogni kind ha l'ossatura comune più i suoi vestiti", () => {
    for (const kind of Object.values(TaskKind)) {
      const fields = fieldsForKind(kind);
      expect(fields).toContain("title");
      expect(fields).toContain("statusId");
    }
    expect(fieldsForKind(TaskKind.DEAL)).toContain("dealValue");
    expect(fieldsForKind(TaskKind.DEAL)).not.toContain("projectId");
    expect(fieldsForKind(TaskKind.ADMIN)).toContain("recurrenceTemplateId");
    expect(fieldsForKind(TaskKind.PERSONAL)).toContain("boardId");
    expect(fieldsForKind(TaskKind.PERSONAL)).not.toContain("dealStageId");
  });

  it("i campi condivisi dichiarano tutti i loro kind", () => {
    // misurato in produzione: il tipo di attività vive su scadenzario E progetti
    expect(kindsForField("activityTypeId").sort()).toEqual(["ADMIN", "PROJECT"]);
    // l'origine ticket segue il task quando la lavorazione entra in un progetto
    expect(isFieldForKind("ticketPriority", TaskKind.PROJECT)).toBe(true);
    expect(isFieldForKind("relatedProjectId", TaskKind.DEAL)).toBe(true);
    expect(kindsForField("colonnaInventata")).toEqual([]);
  });

  it("ogni gruppo nomina almeno un kind e almeno un campo", () => {
    for (const [name, group] of Object.entries(TASK_FIELD_GROUPS)) {
      expect(group.kinds.length, name).toBeGreaterThan(0);
      expect(group.fields.length, name).toBeGreaterThan(0);
    }
  });
});
