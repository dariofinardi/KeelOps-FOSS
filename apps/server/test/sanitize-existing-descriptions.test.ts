// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityCategory, TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

const { tempDir } = prepareTestDb("sanitizedesc");

const { prismaRaw } = await import("../src/db");
const { sanitizeExistingDescriptions } = await import("../prisma/sanitize-existing-descriptions");

let sporco = "";
let pulito = "";

beforeAll(async () => {
  const autore = await prismaRaw.user.create({
    data: { email: "a@x.local", name: "Autore", role: UserRole.ADMIN },
  });
  const status = await prismaRaw.taskStatus.findFirstOrThrow({
    where: { category: ActivityCategory.ADMIN },
  });
  const crea = async (title: string, description: string) => {
    const t = await prismaRaw.task.create({
      data: { kind: TaskKind.ADMIN, title, statusId: status.id, creatorId: autore.id },
    });
    // Anche prismaRaw passa dal write-guard, quindi una create ripulirebbe già
    // il testo. Le righe pre-guard esistono perché scritte con SQL, prima che il
    // guard ci fosse: qui le ricreo così, scavalcando l'estensione Prisma.
    await prismaRaw.$executeRawUnsafe(
      'UPDATE "Task" SET description = ? WHERE id = ?',
      description,
      t.id,
    );
    return t.id;
  };
  sporco = await crea("Con XSS", '<p>Ciao</p><img src=x onerror="alert(1)">');
  pulito = await crea("Gia pulito", "<p>Testo onesto</p>");
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bonifica delle descrizioni esistenti", () => {
  it("in anteprima non scrive niente ma conta cosa cambierebbe", async () => {
    const { changed } = await sanitizeExistingDescriptions(true, { backup: false });
    expect(changed).toBe(1);
    const t = await prismaRaw.task.findUniqueOrThrow({ where: { id: sporco } });
    expect(t.description).toContain("onerror"); // ancora sporca: era solo un'anteprima
  });

  it("ripulisce la riga pericolosa e lascia intatta quella onesta", async () => {
    const { changed } = await sanitizeExistingDescriptions(false, { backup: false });
    expect(changed).toBe(1);
    const cattiva = await prismaRaw.task.findUniqueOrThrow({ where: { id: sporco } });
    expect(cattiva.description).not.toContain("onerror");
    expect(cattiva.description).toContain("Ciao");
    const buona = await prismaRaw.task.findUniqueOrThrow({ where: { id: pulito } });
    expect(buona.description).toBe("<p>Testo onesto</p>");
  });

  it("è idempotente: un secondo giro non cambia niente", async () => {
    const { changed } = await sanitizeExistingDescriptions(false, { backup: false });
    expect(changed).toBe(0);
  });
});
