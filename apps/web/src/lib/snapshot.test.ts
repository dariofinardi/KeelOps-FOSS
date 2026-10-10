// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { createSnapshot } from "./snapshot";

interface Record {
  title: string;
  status: { id: string };
  assignee: { id: string } | null;
  tags: Array<{ id: string }>;
}

interface Snap {
  title: string;
  statusId: string;
  assigneeId: string | null;
  tagIds: string[];
}

const snapshotter = createSnapshot<Record, Snap>({
  title: { label: "Titolo", read: (r) => r.title },
  statusId: { label: "Stato", read: (r) => r.status.id },
  assigneeId: { label: "Assegnatario", read: (r) => r.assignee?.id ?? null },
  tagIds: { label: "Tag", read: (r) => r.tags.map((t) => t.id).sort() },
});

const record = (over: Partial<Record> = {}): Record => ({
  title: "Fattura Acme",
  status: { id: "s1" },
  assignee: { id: "u1" },
  tags: [{ id: "t1" }, { id: "t2" }],
  ...over,
});

describe("createSnapshot", () => {
  it("fotografa i campi dichiarati, appiattendo i riferimenti", () => {
    expect(snapshotter.take(record())).toEqual({
      title: "Fattura Acme",
      statusId: "s1",
      assigneeId: "u1",
      tagIds: ["t1", "t2"],
    });
  });

  it("senza modifiche non c'è niente da chiedere all'utente", () => {
    const snap = snapshotter.take(record());
    expect(snapshotter.changed(snap, record())).toEqual([]);
  });

  it("dice in italiano quali campi sono cambiati, in ordine di dichiarazione", () => {
    const snap = snapshotter.take(record());
    const changed = snapshotter.changed(snap, record({ title: "Fattura Beta", assignee: null }));
    expect(changed).toEqual(["Titolo", "Assegnatario"]);
  });

  it("gli elenchi si confrontano elemento per elemento, non per riferimento", () => {
    // Senza questo, i tag risulterebbero sempre modificati: la fotografia e il
    // record hanno due array diversi con lo stesso contenuto.
    const snap = snapshotter.take(record());
    expect(snapshotter.changed(snap, record({ tags: [{ id: "t1" }, { id: "t2" }] }))).toEqual([]);
    expect(snapshotter.changed(snap, record({ tags: [{ id: "t1" }] }))).toEqual(["Tag"]);
  });

  it("un confronto su misura ha la precedenza", () => {
    const caseInsensitive = createSnapshot<{ name: string }, { name: string }>({
      name: {
        label: "Nome",
        read: (r) => r.name,
        equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
      },
    });
    const snap = caseInsensitive.take({ name: "Acme" });
    expect(caseInsensitive.changed(snap, { name: "ACME" })).toEqual([]);
    expect(caseInsensitive.changed(snap, { name: "Beta" })).toEqual(["Nome"]);
  });
});
