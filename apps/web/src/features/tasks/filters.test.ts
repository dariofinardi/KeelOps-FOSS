import { describe, expect, it } from "vitest";
import type { TaskFilters } from "@kancrm/shared";
import {
  activeFilterCount,
  clampPage,
  invalidFilters,
  taskExportQuery,
  taskListQuery,
  type AvailableFilterOptions,
  type TaskFilterValues,
} from "./filters";

const NO_FILTERS: TaskFilterValues = {
  statusId: "",
  assigneeId: "",
  activityTypeId: "",
  tagId: "",
  companyId: "",
};

const available: AvailableFilterOptions = {
  statusIds: ["s1", "s2"],
  assigneeIds: ["u1"],
  activityTypeIds: ["t1"],
  tagIds: ["g1"],
  companyIds: ["c1"],
};

describe("activeFilterCount", () => {
  it("conta i filtri valorizzati, ricerca compresa", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, statusId: "s1" })).toBe(1);
    expect(activeFilterCount({ ...NO_FILTERS, statusId: "s1", tagId: "g1" }, "fattura")).toBe(3);
  });

  it("ignora una ricerca di soli spazi", () => {
    expect(activeFilterCount(NO_FILTERS, "   ")).toBe(0);
  });

  it('conta anche "Mostra chiusi": resta acceso tra una visita e l\'altra', () => {
    // Senza questo l'utente vedeva i task completati in elenco senza capire
    // quale filtro glieli stesse mostrando.
    expect(activeFilterCount(NO_FILTERS, "", true)).toBe(1);
    expect(activeFilterCount({ ...NO_FILTERS, statusId: "s1" }, "", true)).toBe(2);
    expect(activeFilterCount({ ...NO_FILTERS, statusId: "s1" }, "", false)).toBe(1);
  });
});

describe("invalidFilters", () => {
  it("azzera un filtro che punta a un valore non più esistente (stato eliminato)", () => {
    // Caso reale: lo stato salvato è stato unito in un altro e non esiste più →
    // la lista restava vuota senza mostrare alcun filtro attivo.
    expect(invalidFilters({ ...NO_FILTERS, statusId: "eliminato" }, available)).toEqual({
      statusId: "",
    });
  });

  it("non tocca i filtri validi", () => {
    expect(
      invalidFilters(
        { statusId: "s2", assigneeId: "u1", activityTypeId: "t1", tagId: "g1", companyId: "c1" },
        available,
      ),
    ).toEqual({});
  });

  it("azzera più filtri insieme", () => {
    expect(
      invalidFilters(
        { statusId: "x", assigneeId: "y", activityTypeId: "t1", tagId: "", companyId: "sparito" },
        available,
      ),
    ).toEqual({ statusId: "", assigneeId: "", companyId: "" });
  });

  it("con opzioni non ancora caricate non azzera nulla (non perde i filtri al primo render)", () => {
    const loading: AvailableFilterOptions = {
      statusIds: [],
      assigneeIds: [],
      activityTypeIds: [],
      companyIds: [],
      tagIds: [],
    };
    expect(invalidFilters({ ...NO_FILTERS, statusId: "s1", tagId: "g1" }, loading)).toEqual({});
  });
});

describe("clampPage", () => {
  it("riporta nel range una pagina oltre l'ultima (tabella vuota con record esistenti)", () => {
    expect(clampPage(5, 60, 50)).toBe(2); // 60 record, 50 per pagina → max 2
    expect(clampPage(3, 10, 50)).toBe(1);
  });

  it("lascia intatta una pagina valida", () => {
    expect(clampPage(2, 120, 50)).toBe(2);
    expect(clampPage(1, 10, 50)).toBe(1);
  });

  it("senza record torna alla prima pagina", () => {
    expect(clampPage(4, 0, 50)).toBe(1);
  });
});

describe("serializzazione filtri → parametri", () => {
  it("ogni filtro del contratto arriva nella query string", () => {
    // È il test-inventario nato da un bug reale: dueWithinDays esisteva in
    // schema, server e tendina, ma la serializzazione (a mano) non lo mandava —
    // il range sembrava attivo e non filtrava niente. Un filtro nuovo che manca
    // da taskListQuery deve fallire QUI, non in produzione.
    const filters: Required<
      Pick<
        TaskFilters,
        | "q"
        | "statusId"
        | "assigneeId"
        | "projectId"
        | "activityTypeId"
        | "tagId"
        | "category"
        | "dueWithinDays"
        | "includeClosed"
        | "page"
        | "pageSize"
        | "sortBy"
        | "sortDir"
      >
    > = {
      q: "fattura",
      statusId: "s1",
      assigneeId: "u1",
      projectId: "p1",
      activityTypeId: "a1",
      tagId: "t1",
      category: "SALES",
      dueWithinDays: 15,
      includeClosed: true,
      page: 2,
      pageSize: 50,
      sortBy: "title",
      sortDir: "desc",
    };
    const params = new URLSearchParams(taskListQuery(filters));
    for (const key of Object.keys(filters)) {
      expect(params.get(key), `parametro "${key}" non serializzato`).not.toBeNull();
    }
    expect(params.get("dueWithinDays")).toBe("15");
  });

  it("l'export manda SOLO i filtri di base: è uno scarico grezzo, per scelta", () => {
    // Decisione del 06/08/2026: il CSV non è la fotografia della tabella.
    // Mandare parametri che il server ignora farebbe credere il contrario.
    const params = new URLSearchParams(
      taskExportQuery({
        q: "fattura",
        statusId: "s1",
        assigneeId: "u1",
        projectId: "p1",
        includeClosed: true,
        activityTypeId: "a1",
        tagId: "t1",
        dueWithinDays: 15,
        sortBy: "title",
        page: 3,
      }),
    );
    expect([...params.keys()].sort()).toEqual([
      "assigneeId",
      "includeClosed",
      "projectId",
      "q",
      "statusId",
    ]);
  });
});
