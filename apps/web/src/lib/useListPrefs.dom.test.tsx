import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListPrefs } from "./useListPrefs";

const KEY = "test-list-prefs";
const DEFAULTS = { view: "agenda", statusId: "", includeClosed: false };

afterEach(() => localStorage.removeItem(KEY));

describe("useListPrefs", () => {
  it("parte dai default, persiste le modifiche e le ricarica", () => {
    const first = renderHook(() => useListPrefs(KEY, DEFAULTS));
    expect(first.result.current.prefs).toEqual(DEFAULTS);

    act(() => first.result.current.update({ statusId: "s1" }));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ statusId: "s1" });

    // Nuovo mount (nuova visita): riparte da quanto salvato.
    const second = renderHook(() => useListPrefs(KEY, DEFAULTS));
    expect(second.result.current.prefs.statusId).toBe("s1");
  });

  it("prefs corrotte o parziali → default senza crash", () => {
    localStorage.setItem(KEY, "{non-json");
    const broken = renderHook(() => useListPrefs(KEY, DEFAULTS));
    expect(broken.result.current.prefs).toEqual(DEFAULTS);

    localStorage.setItem(KEY, JSON.stringify({ view: "table" })); // manca il resto
    const partial = renderHook(() => useListPrefs(KEY, DEFAULTS));
    expect(partial.result.current.prefs).toEqual({ ...DEFAULTS, view: "table" });
  });

  it("update torna a pagina 1, heal no", () => {
    const { result } = renderHook(() => useListPrefs(KEY, DEFAULTS));
    act(() => result.current.setPage(3));
    act(() => result.current.heal({})); // niente da correggere: nessun effetto
    expect(result.current.page).toBe(3);
    act(() => result.current.heal({ statusId: "" }));
    expect(result.current.page).toBe(3); // la correzione non riporta in prima pagina
    act(() => result.current.update({ statusId: "y" }));
    expect(result.current.page).toBe(1);
  });

  it("clampPageTo riporta la pagina nel range", () => {
    const { result } = renderHook(() => useListPrefs(KEY, DEFAULTS));
    act(() => result.current.setPage(5));
    act(() => result.current.clampPageTo(60, 50)); // max 2 pagine
    expect(result.current.page).toBe(2);
  });
});
