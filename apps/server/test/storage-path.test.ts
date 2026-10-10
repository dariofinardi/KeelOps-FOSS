// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tempDir = mkdtempSync(path.join(tmpdir(), "kancrm-test-path-"));
process.env.DATABASE_PATH = path.join(tempDir, "test.db");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");

const { attachmentAbsolutePath } = await import("../src/modules/attachments/storage");

describe("attachmentAbsolutePath — difesa path traversal (B7)", () => {
  it("accetta i path dentro uploadsDir", () => {
    const p = attachmentAbsolutePath("task123/nota.txt");
    expect(p.startsWith(path.join(tempDir, "uploads"))).toBe(true);
  });
  it("rifiuta la risalita fuori da uploadsDir", () => {
    expect(() => attachmentAbsolutePath("../evil.txt")).toThrow();
    expect(() => attachmentAbsolutePath("../../etc/passwd")).toThrow();
  });
  it("rifiuta una cartella sorella con prefisso simile (bug del vecchio startsWith)", () => {
    expect(() => attachmentAbsolutePath("../uploads-altro/x.txt")).toThrow();
  });
  it("rifiuta un path assoluto", () => {
    expect(() => attachmentAbsolutePath("/etc/passwd")).toThrow();
  });
});
