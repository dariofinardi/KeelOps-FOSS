import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readUpTo } from "../src/lib/read-limited";

describe("readUpTo", () => {
  it("legge tutto quando sta sotto il tetto", async () => {
    const r = await readUpTo(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), 10);
    expect(r).toEqual({ buffer: Buffer.from("abcd"), troppoGrande: false });
  });

  it("si ferma al tetto senza tenere il resto", async () => {
    const pezzi = Array.from({ length: 100 }, () => Buffer.alloc(1024, 1));
    const r = await readUpTo(Readable.from(pezzi), 4096);
    expect(r.troppoGrande).toBe(true);
    expect(r.buffer.length).toBe(0);
  });
});
