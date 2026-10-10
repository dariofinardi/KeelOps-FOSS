// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityCategory } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";
import { assignOnCommentScenario } from "./support/assign-on-comment-scenario";

/**
 * **Scrivere in chat non assegna niente** (28/09/2026). Dal 18/09 un interno
 * che commentava un task di nessuno ne diventava l'assegnatario: sbagliato,
 * ha detto il committente — una richiesta aperta da Francesca e poi commentata
 * da lei le finiva in mano, e doveva restare libera. Un task si prende quando
 * lo si **sposta di stato** (`autoAssign` in `applyTaskUpdate`), non quando ci
 * si scrive.
 */
const { tempDir } = prepareTestDb("assign-on-comment");

let ctx: Awaited<ReturnType<typeof assignOnCommentScenario>>;
beforeAll(async () => {
  ctx = await assignOnCommentScenario();
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("il commento non prende in carico", () => {
  it("un task amministrativo di nessuno resta di nessuno, e nel suo stato", async () => {
    const primo = await ctx.stato(ActivityCategory.ADMIN);
    const id = await ctx.nuovoTask({ kind: "ADMIN", statusId: primo.id });

    expect((await ctx.scrivi("anna", id)).statusCode).toBe(201);
    const task = await ctx.prisma.task.findUniqueOrThrow({ where: { id } });
    expect(task.assigneeId).toBeNull();
    expect(task.statusId).toBe(primo.id);
    const storico = await ctx.prisma.activityLog.findMany({ where: { taskId: id } });
    expect(storico.map((r) => r.action)).toEqual(["commented"]);
  });

  it("spostandolo di stato invece lo si prende", async () => {
    const primo = await ctx.stato(ActivityCategory.ADMIN);
    const altro = await ctx.prisma.taskStatus.findFirstOrThrow({
      where: { category: ActivityCategory.ADMIN, isClosed: false, id: { not: primo.id } },
      orderBy: { order: "asc" },
    });
    const id = await ctx.nuovoTask({ kind: "ADMIN", statusId: primo.id });
    await ctx.scrivi("bruno", id);
    const mosso = await ctx.app.inject({
      method: "PATCH",
      url: `/api/tasks/${id}`,
      headers: { cookie: ctx.cookie.bruno! },
      payload: { statusId: altro.id },
    });
    expect(mosso.statusCode).toBe(200);
    expect((await ctx.prisma.task.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(
      ctx.ids.bruno,
    );
  });
});
