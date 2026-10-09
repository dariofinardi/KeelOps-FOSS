import { describe, expect, it } from "vitest";
import { csvCell } from "../src/lib/csv";

describe("csvCell — anti CSV injection (B6)", () => {
  it("racchiude e raddoppia le virgolette", () => {
    expect(csvCell("normale")).toBe('"normale"');
    expect(csvCell('con "virgolette"')).toBe('"con ""virgolette"""');
  });
  it("neutralizza le formule con un apostrofo iniziale", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@x")).toBe(`"'@x"`);
  });
  it("lascia intatti i valori innocui", () => {
    expect(csvCell("Mario Rossi")).toBe('"Mario Rossi"');
    expect(csvCell("2026-08-01")).toBe('"2026-08-01"');
  });
});
