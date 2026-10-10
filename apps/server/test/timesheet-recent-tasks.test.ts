// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { orderByLastTouch } from "../src/modules/hours/recent-tasks";

const task = (id: string, updatedAt: string) => ({ id, updatedAt: new Date(updatedAt) });
const touch = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([id, when]) => [id, new Date(when)]));

describe("ordine della tendina del timesheet", () => {
  it("prima quelli toccati per ultimi", () => {
    const ordinati = orderByLastTouch(
      [
        task("vecchio", "2026-08-01T09:00:00Z"),
        task("ieri", "2026-08-05T18:00:00Z"),
        task("stamattina", "2026-08-06T08:30:00Z"),
      ],
      new Map(),
    );
    expect(ordinati.map((t) => t.id)).toEqual(["stamattina", "ieri", "vecchio"]);
  });

  it("conta anche quello che ho fatto io e che non tocca la riga del task", () => {
    // Un commento o un allegato non cambiano `Task.updatedAt`, ma sono
    // esattamente "metterci le mani": il task su cui ho discusso stamattina
    // deve stare davanti a uno che non guardo da una settimana.
    const ordinati = orderByLastTouch(
      [
        task("discusso-stamattina", "2026-07-20T09:00:00Z"),
        task("modificato-ieri", "2026-08-05T18:00:00Z"),
      ],
      touch({ "discusso-stamattina": "2026-08-06T08:45:00Z" }),
    );
    expect(ordinati.map((t) => t.id)).toEqual(["discusso-stamattina", "modificato-ieri"]);
  });

  it("vale il più recente dei due, non l'ultimo arrivato", () => {
    // Il collega ha spostato di stato un task mio dopo il mio ultimo commento:
    // per me è tornato attuale, e deve risalire.
    const ordinati = orderByLastTouch(
      [task("mosso-dal-collega", "2026-08-06T11:00:00Z"), task("mio", "2026-08-06T09:00:00Z")],
      touch({ "mosso-dal-collega": "2026-08-01T09:00:00Z", mio: "2026-08-06T10:00:00Z" }),
    );
    expect(ordinati.map((t) => t.id)).toEqual(["mosso-dal-collega", "mio"]);
  });

  it("a parità di istante l'ordine è sempre lo stesso", () => {
    // La tendina carica a blocchi: un ordine ballerino farebbe comparire lo
    // stesso task due volte, o mai.
    const stesso = "2026-08-06T09:00:00Z";
    const uno = orderByLastTouch([task("b", stesso), task("a", stesso)], new Map());
    const due = orderByLastTouch([task("a", stesso), task("b", stesso)], new Map());
    expect(uno.map((t) => t.id)).toEqual(["a", "b"]);
    expect(due.map((t) => t.id)).toEqual(uno.map((t) => t.id));
  });

  it("non modifica l'elenco che riceve", () => {
    const elenco = [task("a", "2026-08-01T09:00:00Z"), task("b", "2026-08-06T09:00:00Z")];
    orderByLastTouch(elenco, new Map());
    expect(elenco.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
