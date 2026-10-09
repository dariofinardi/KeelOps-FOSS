import { describe, expect, it } from "vitest";
import { PROJECT_ICONS } from "@kancrm/shared";
import { filterIconGroups } from "./icon-search";

const namesIn = (groups: ReturnType<typeof filterIconGroups>) => groups.flatMap((g) => g.icons);

describe("filterIconGroups", () => {
  it("senza ricerca mostra tutte le icone, divise per tema", () => {
    const groups = filterIconGroups("");
    expect(namesIn(groups)).toHaveLength(PROJECT_ICONS.length);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]!.label).toBe("Sviluppo");
  });

  it("trova per nome inglese dell'icona", () => {
    expect(namesIn(filterIconGroups("shield"))).toContain("ShieldCheck");
    expect(namesIn(filterIconGroups("kanban"))).toContain("FolderKanban");
  });

  it("trova per tema in italiano: l'interfaccia non è in inglese", () => {
    // Chi cerca "sicurezza" non sa che l'icona si chiama Shield.
    const sicurezza = namesIn(filterIconGroups("sicurezza"));
    expect(sicurezza).toContain("Shield");
    expect(sicurezza).toContain("Lock");
    expect(sicurezza).not.toContain("Pizza");
  });

  it("i temi senza corrispondenze spariscono, non restano intestazioni vuote", () => {
    const groups = filterIconGroups("pizza");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.icons).toEqual(["Pizza"]);
  });

  it("una ricerca senza risultati non restituisce nulla", () => {
    expect(filterIconGroups("qwertyuiop")).toEqual([]);
  });

  it("ignora maiuscole e spazi intorno", () => {
    expect(namesIn(filterIconGroups("  ROCKET "))).toEqual(["Rocket"]);
  });
});
