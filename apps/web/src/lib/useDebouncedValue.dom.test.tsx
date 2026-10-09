import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("si aggiorna solo a digitazione ferma", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "" },
    });

    rerender({ v: "f" });
    rerender({ v: "fa" });
    rerender({ v: "fat" });
    expect(result.current).toBe(""); // mentre si digita non cambia

    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("fat"); // arriva solo l'ultimo valore
  });

  it("ogni nuovo tasto riparte il timer", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "ab" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ v: "abc" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a"); // 400ms totali ma mai 300 di quiete
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("abc");
  });
});
