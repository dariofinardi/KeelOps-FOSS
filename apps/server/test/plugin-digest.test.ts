// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationType, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **Il riepilogo del mattino accoglie le righe dei plugin** (06/09/2026):
 * un plugin registrato con `riepilogoMattutino` nomina le persone e scrive
 * le righe nella loro lingua; una riga basta da sola a far partire il
 * riepilogo; un plugin che sbaglia non ferma gli altri né il riepilogo.
 */
const { dbPath } = prepareTestDb("plugin-digest");
process.env.DATABASE_PATH = dbPath;

const { prisma } = await import("../src/db");
const { sendDueDigests } = await import("../src/modules/notifications/service");
const { registraRiepilogoMattutino, contributiAlRiepilogo } =
  await import("../src/plugins/plugin-host");

let tedesca: string;
let italiano: string;
const OGGI = new Date("2026-09-07T07:00:00.000Z");

beforeAll(async () => {
  tedesca = (
    await prisma.user.create({
      data: { email: "greta@x.local", name: "Greta", role: UserRole.MEMBER, locale: "de" },
    })
  ).id;
  italiano = (
    await prisma.user.create({
      data: { email: "italo@x.local", name: "Italo", role: UserRole.MEMBER, locale: "it" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dbPath, { force: true });
});

describe("le righe dei plugin nel riepilogo", () => {
  it("un plugin nomina le persone e scrive nella loro lingua; una riga basta a far partire il riepilogo", async () => {
    const via = registraRiepilogoMattutino("finto", async ({ oggi }) => {
      expect(oggi).toBe("2026-09-07");
      return [
        { userId: tedesca, righe: (locale) => [`Boards (${locale}): 2`] },
        { userId: italiano, righe: (locale) => [`Bacheche (${locale}): 1`] },
      ];
    });
    try {
      expect(await sendDueDigests(OGGI)).toBe(2);
    } finally {
      via();
    }
    const righe = await prisma.notification.findMany({
      where: { type: NotificationType.DUE_DIGEST },
      orderBy: { createdAt: "asc" },
    });
    const testi = Object.fromEntries(righe.map((r) => [r.userId, JSON.parse(r.payload).text]));
    expect(testi[tedesca]).toContain("Boards (de): 2");
    expect(testi[italiano]).toContain("Bacheche (it): 1");
  });

  it("un plugin guasto o lento non ferma gli altri, e il log lo dice", async () => {
    const avvisi: string[] = [];
    const viaRotto = registraRiepilogoMattutino("rotto", async () => {
      throw new Error("kaputt");
    });
    const viaLento = registraRiepilogoMattutino(
      "lento",
      () => new Promise(() => undefined) as never,
    );
    const viaBuono = registraRiepilogoMattutino("buono", async () => [
      { userId: tedesca, righe: () => ["ok"] },
    ]);
    try {
      const per = await contributiAlRiepilogo("2026-09-08", (m) => avvisi.push(m), 50);
      expect(per.get(tedesca)?.map((righe) => righe("de"))).toEqual([["ok"]]);
      expect(avvisi.some((m) => m.includes('"rotto"') && m.includes("kaputt"))).toBe(true);
      expect(avvisi.some((m) => m.includes('"lento"'))).toBe(true);
    } finally {
      viaRotto();
      viaLento();
      viaBuono();
    }
  });
});
