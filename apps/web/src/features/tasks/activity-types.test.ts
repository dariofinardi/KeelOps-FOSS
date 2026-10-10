// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { ActivityCategory, type ActivityType } from "@kancrm/shared";
import { groupActivityTypes } from "./activity-types";

const type = (id: string, name: string, category: ActivityCategory): ActivityType =>
  ({ id, name, category, color: "#000", isMeeting: false }) as ActivityType;

const TYPES = [
  type("a1", "Emissione fattura", ActivityCategory.ADMIN),
  type("s1", "Telefonata", ActivityCategory.SALES),
  type("d1", "Fix", ActivityCategory.DEV),
  type("g1", "Riunione", ActivityCategory.GENERAL),
];

const labels = (groups: ReturnType<typeof groupActivityTypes>) => groups.map((g) => g.label);
const names = (groups: ReturnType<typeof groupActivityTypes>) =>
  groups.flatMap((g) => g.items.map((t) => t.name));

describe("groupActivityTypes", () => {
  it("divide per categoria, con l'intestazione da mostrare", () => {
    // È la stessa divisione che vale nella tendina del dettaglio e nelle celle
    // degli elenchi: prima la seconda era un elenco piatto di venti voci.
    const groups = groupActivityTypes(TYPES, {});
    expect(labels(groups)).toEqual([
      "Area amministrativa",
      "Area commerciale",
      "Area tecnica",
      "Tutte le aree",
    ]);
  });

  it("dentro un modulo restano il mestiere e i tipi validi in ogni area", () => {
    const groups = groupActivityTypes(TYPES, { kind: "DEAL" });
    expect(labels(groups)).toEqual(["Area commerciale", "Tutte le aree"]);
    expect(names(groups)).toEqual(["Telefonata", "Riunione"]);
  });

  it("il tipo già impostato resta in elenco anche se di un'altra categoria", () => {
    // Senza, la tendina mostrerebbe "Nessun tipo" e al primo tocco cancellerebbe
    // un valore che nessuno aveva chiesto di togliere.
    const groups = groupActivityTypes(TYPES, { kind: "DEAL", value: "a1" });
    expect(names(groups)).toContain("Emissione fattura");
  });

  it("i gruppi vuoti non lasciano intestazioni orfane", () => {
    const groups = groupActivityTypes([TYPES[0]!], {});
    expect(labels(groups)).toEqual(["Area amministrativa"]);
  });
});
