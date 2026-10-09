// Copyright (c) 2026 Jugaad s.r.l.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { hoursScenario } from "./support/hours-scenario";

process.env.KEELOPS_EDITION = "community";
prepareTestDb("hours-community");

/**
 * **The community timesheet** (decided 08/10/2026): the grid for everyone,
 * the summaries only for managers, none of the commercial extras.
 */
let ctx: Awaited<ReturnType<typeof hoursScenario>>;
beforeAll(async () => {
  ctx = await hoursScenario();
});
afterAll(async () => {
  await ctx?.app.close();
});

const get = (url: string, cookie: string) =>
  ctx.app.inject({ method: "GET", url, headers: { cookie } });

describe("timesheet, community edition", () => {
  it("everyone has their own grid, by month and by week", async () => {
    const mese = await get("/api/timesheet?period=2026-07", ctx.cookies.worker);
    expect(mese.statusCode).toBe(200);
    expect(mese.json().total).toBe(8);
    const settimana = await get("/api/timesheet?period=2026-07-20", ctx.cookies.worker);
    expect(settimana.json().total).toBe(5);
  });

  it("the summaries are for managers only", async () => {
    for (const url of [
      "/api/timesheet/summary?month=2026-07&groupBy=user",
      "/api/timesheet/breakdown?period=2026-07-06",
    ]) {
      expect((await get(url, ctx.cookies.worker)).statusCode).toBe(403);
      expect((await get(url, ctx.cookies.manager)).statusCode).toBe(200);
      expect((await get(url, ctx.cookies.admin)).statusCode).toBe(200);
    }
  });

  it("a manager opens a colleague's grid, read-only", async () => {
    const r = await get(
      `/api/timesheet?period=2026-07&userId=${ctx.workerId}`,
      ctx.cookies.manager,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 8, editable: false });
    expect((await get("/api/timesheet/users", ctx.cookies.manager)).statusCode).toBe(200);
    expect((await get("/api/timesheet/users", ctx.cookies.worker)).statusCode).toBe(403);
  });

  it("the commercial extras are not there", async () => {
    for (const url of [
      "/api/timesheet/hints?period=2026-07",
      "/api/timesheet/analytics?month=2026-07",
      "/api/timesheet/export?month=2026-07",
    ]) {
      expect((await get(url, ctx.cookies.admin)).statusCode).toBe(404);
    }
    const auto = await ctx.app.inject({
      method: "POST",
      url: "/api/timesheet/rows/auto",
      headers: { cookie: ctx.cookies.worker },
      payload: { period: "2026-07" },
    });
    expect(auto.statusCode).toBe(404);
  });

  it("the user flags tell the page who may browse other people's hours", async () => {
    const me = async (cookie: string) => (await get("/api/auth/me", cookie)).json();
    expect((await me(ctx.cookies.manager)).canViewTeamTimesheet).toBe(true);
    expect((await me(ctx.cookies.worker)).canViewTeamTimesheet).toBe(false);
    expect((await me(ctx.cookies.admin)).canViewAllTimesheets).toBe(true);
  });
});
