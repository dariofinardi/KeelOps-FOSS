import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@kancrm/shared";
import { RECENT_CLOSED_MAX, endOfWeekISO, groupAgendaTasks } from "./agenda-groups";

const fmt = (iso: string) => iso;

function task(
  title: string,
  dueDate: string | null,
  isClosed = false,
  closedAt: string | null = isClosed ? "2026-07-27T09:00:00.000Z" : null,
): TaskListItem {
  return {
    id: title,
    title,
    dueDate,
    closedAt,
    status: { id: "s", name: "x", isClosed },
  } as TaskListItem;
}

const TODAY = "2026-07-27"; // lunedì
const groupOf = (groups: ReturnType<typeof groupAgendaTasks>, key: string) =>
  groups.find((g) => g.key === key)?.tasks.map((t) => t.title) ?? [];

describe("groupAgendaTasks", () => {
  it("un task completato non è mai 'in ritardo', nemmeno con la data passata", () => {
    // Il caso segnalato: con "Mostra chiusi" acceso i completati finivano in
    // "IN RITARDO" solo perché la loro scadenza era passata.
    const groups = groupAgendaTasks(
      [task("chiuso ieri", "2026-07-01", true), task("aperto ieri", "2026-07-01")],
      TODAY,
      null,
      fmt,
    );
    expect(groupOf(groups, "overdue")).toEqual(["aperto ieri"]);
    expect(groupOf(groups, "closed")).toEqual(["chiuso ieri"]);
  });

  it("i completati restano fuori anche da oggi, settimana e senza scadenza", () => {
    const groups = groupAgendaTasks(
      [
        task("oggi chiuso", TODAY, true),
        task("oggi aperto", TODAY),
        task("settimana chiuso", "2026-07-30", true),
        task("senza data chiuso", null, true),
      ],
      TODAY,
      null,
      fmt,
    );
    expect(groupOf(groups, "today")).toEqual(["oggi aperto"]);
    expect(groupOf(groups, "week")).toEqual([]);
    expect(groupOf(groups, "nodate")).toEqual([]);
    expect(groupOf(groups, "closed").sort()).toEqual([
      "oggi chiuso",
      "senza data chiuso",
      "settimana chiuso",
    ]);
  });

  it("mostra solo i completati di recente, dal più recente", () => {
    // Conta quando è stato chiuso, non la scadenza: un task con scadenza vecchia
    // ma chiuso ieri è lavoro appena fatto.
    const groups = groupAgendaTasks(
      [
        task("chiuso 20 giorni fa", "2026-01-01", true, "2026-07-07T10:00:00.000Z"),
        task("chiuso ieri", "2026-01-01", true, "2026-07-26T10:00:00.000Z"),
        task("chiuso oggi", "2026-01-01", true, "2026-07-27T08:00:00.000Z"),
      ],
      TODAY,
      null,
      fmt,
    );
    expect(groupOf(groups, "closed")).toEqual(["chiuso oggi", "chiuso ieri"]);
    expect(groups.find((g) => g.key === "closed")?.note).toContain("Altri 1");
  });

  it("non supera il tetto e dice quanti restano fuori", () => {
    const many = Array.from({ length: RECENT_CLOSED_MAX + 5 }, (_, i) =>
      task(`chiuso ${i}`, null, true, `2026-07-2${(i % 7) + 1}T10:00:00.000Z`),
    );
    const groups = groupAgendaTasks(many, TODAY, null, fmt);
    const closed = groups.find((g) => g.key === "closed")!;
    expect(closed.tasks).toHaveLength(RECENT_CLOSED_MAX);
    expect(closed.note).toContain("Altri 5");
  });

  it("lo storico senza data di chiusura non riemerge in agenda", () => {
    // Task importati e chiusi senza closedAt: non sono lavoro "appena fatto".
    const groups = groupAgendaTasks(
      [task("importato chiuso", "2026-01-01", true, null)],
      TODAY,
      null,
      fmt,
    );
    expect(groups.some((g) => g.key === "closed")).toBe(false);
  });

  it("senza task chiusi non compare il gruppo Completati", () => {
    const groups = groupAgendaTasks([task("aperto", TODAY)], TODAY, null, fmt);
    expect(groups.some((g) => g.key === "closed")).toBe(false);
  });

  it("scegliendo un giorno si vede tutto quel che cadeva in quella data", () => {
    const groups = groupAgendaTasks(
      [task("chiuso", "2026-07-20", true), task("aperto", "2026-07-20"), task("altro", TODAY)],
      TODAY,
      "2026-07-20",
      fmt,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tasks.map((t) => t.title)).toEqual(["chiuso", "aperto"]);
  });

  it("la settimana finisce di domenica", () => {
    expect(endOfWeekISO("2026-07-27")).toBe("2026-08-02"); // lunedì → domenica
    expect(endOfWeekISO("2026-08-02")).toBe("2026-08-02"); // domenica → sé stessa
  });
});
