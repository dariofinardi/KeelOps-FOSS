import { describe, expect, it } from "vitest";
import { formatBytes } from "./bytes";

describe("la dimensione di un file", () => {
  it("sotto il mega si legge in KB, senza decimali", () => {
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("sopra il mega si legge in MB", () => {
    expect(formatBytes(5.9 * 1024 * 1024)).toBe("5.9 MB");
  });

  it("sopra il giga si legge in GB: un archivio grosso non si divide a mente", () => {
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe("3.50 GB");
  });
});
