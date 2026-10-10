// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { TaskDetail } from "@kancrm/shared";
import { changedFieldLabels, restorePayload, snapshotOf } from "./task-snapshot";

/** Task minimo con i soli campi che lo snapshot osserva. */
function makeTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    title: "Versamento IVA",
    description: "note",
    status: { id: "s1", name: "Assegnato", isClosed: false },
    assignee: { id: "u1", name: "Anna" },
    supervisor: null,
    dueDate: "2026-07-30",
    dueTime: null,
    activityType: { id: "t1", name: "Scadenza fiscale" },
    predecessorId: null,
    tags: [
      { id: "g2", name: "urgente" },
      { id: "g1", name: "fisco" },
    ],
    ...overrides,
  } as unknown as TaskDetail;
}

describe("snapshotOf", () => {
  it("fotografa i campi modificabili, con i tag in ordine stabile", () => {
    expect(snapshotOf(makeTask())).toEqual({
      title: "Versamento IVA",
      description: "note",
      statusId: "s1",
      assigneeId: "u1",
      supervisorId: null,
      dueDate: "2026-07-30",
      dueTime: null,
      activityTypeId: "t1",
      predecessorId: null,
      tagIds: ["g1", "g2"], // ordinati: l'ordine di arrivo non conta come modifica
    });
  });
});

describe("changedFieldLabels", () => {
  it("senza modifiche non elenca nulla", () => {
    const snapshot = snapshotOf(makeTask());
    expect(changedFieldLabels(snapshot, makeTask())).toEqual([]);
  });

  it("elenca i campi cambiati con il nome in italiano", () => {
    const snapshot = snapshotOf(makeTask());
    const changed = changedFieldLabels(
      snapshot,
      makeTask({
        status: { id: "s2", name: "In esecuzione", isClosed: false },
        dueDate: "2026-08-05",
        assignee: null,
      } as Partial<TaskDetail>),
    );
    expect(changed).toEqual(["Stato", "Assegnatario", "Scadenza"]);
  });

  it("riconosce un tag aggiunto e non si confonde con il riordino", () => {
    const snapshot = snapshotOf(makeTask());
    expect(
      changedFieldLabels(
        snapshot,
        makeTask({
          tags: [
            { id: "g1", name: "fisco" },
            { id: "g2", name: "urgente" },
          ],
        } as Partial<TaskDetail>),
      ),
    ).toEqual([]);
    expect(
      changedFieldLabels(
        snapshot,
        makeTask({ tags: [{ id: "g1", name: "fisco" }] } as Partial<TaskDetail>),
      ),
    ).toEqual(["Tag"]);
  });
});

describe("restorePayload", () => {
  it("riporta tutti i campi e include le conferme (è un ripristino, non una scelta nuova)", () => {
    const payload = restorePayload(snapshotOf(makeTask()));
    expect(payload).toMatchObject({
      title: "Versamento IVA",
      statusId: "s1",
      assigneeId: "u1",
      dueDate: "2026-07-30",
      tagIds: ["g1", "g2"],
      confirmSequence: true,
      confirmSubtasks: true,
    });
  });
});
