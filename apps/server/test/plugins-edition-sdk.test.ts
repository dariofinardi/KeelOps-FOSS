// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
// @ts-expect-error — modulo .mjs dell'SDK, senza tipi
import { taskPerimeter } from "../../../plugins/keelops-sdk/perimeter.mjs";
// @ts-expect-error — modulo .mjs del plugin mcp, senza tipi
import { ha, offribile } from "../../../plugins/mcp/lib/edizione.mjs";

/**
 * **L'SDK e il connettore mcp davanti all'edizione** (08/10/2026). Le regole
 * pure: con le funzioni della commerciale (o senza funzioni, come un core di
 * prima) tutto resta com'era; senza `ticket` i ticket escono dal perimetro, e
 * gli strumenti che dichiarano una funzione assente non si offrono.
 */
const membro = { id: "u1", role: "MEMBER" };
const admin = { id: "a1", role: "ADMIN" };
type Perimetro = { where: string; params: string[] };
const p = (user: object): Perimetro => taskPerimeter(user) as Perimetro;

describe("perimetro dei task dell'SDK", () => {
  it("con il modulo dei ticket è lo stesso filtro di un utente senza funzioni", () => {
    const commerciale = new Set(["ticket", "timesheet"]);
    expect(p({ ...membro, funzioni: commerciale })).toEqual(p(membro));
    expect(p({ ...admin, funzioni: commerciale })).toEqual(p(admin));
    expect(p(admin).where).toBe("t.deletedAt IS NULL");
  });

  it("senza il modulo dei ticket, le richieste restano fuori anche all'amministratore", () => {
    for (const utente of [membro, admin]) {
      expect(p({ ...utente, funzioni: new Set() }).where).toContain("t.kind <> 'TICKET'");
    }
    expect(p({ ...membro, funzioni: new Set() }).params).toEqual(p(membro).params);
  });
});

describe("strumenti del connettore mcp", () => {
  it("senza funzioni (core di prima, modo autonomo) c'è tutto", () => {
    expect(ha({ id: "x" }, "timesheet")).toBe(true);
    expect(offribile({ name: "mio_timesheet", richiede: "timesheet" }, { id: "x" })).toBe(true);
  });
  it("uno strumento che richiede una funzione assente non si offre; gli altri sì", () => {
    const community = { id: "x", funzioni: new Set<string>() };
    expect(offribile({ name: "mio_timesheet", richiede: "timesheet" }, community)).toBe(false);
    expect(offribile({ name: "cerca_task" }, community)).toBe(true);
    const commerciale = { id: "x", funzioni: new Set(["timesheet"]) };
    expect(offribile({ name: "mio_timesheet", richiede: "timesheet" }, commerciale)).toBe(true);
  });
});
