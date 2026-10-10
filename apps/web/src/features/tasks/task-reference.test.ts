// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@kancrm/shared";
import { hasTaskReference, taskReferenceOf } from "./task-reference";

const task = (over: Partial<TaskListItem> = {}): TaskListItem =>
  ({
    id: "t1",
    title: "Attività agosto",
    relatedDeal: null,
    project: null,
    relatedProject: null,
    company: null,
    ...over,
  }) as TaskListItem;

describe("a cosa fa capo un task", () => {
  it("l'offerta collegata, con la sua azienda", () => {
    const ref = taskReferenceOf(
      task({
        relatedDeal: { id: "d1", title: "Agente Netico" },
        company: { id: "c1", name: "Coopselios" },
      }),
    );
    expect(ref).toEqual({ label: "Agente Netico", kind: "deal", company: "Coopselios" });
  });

  it("il progetto di appartenenza quando non c'è un'offerta", () => {
    expect(taskReferenceOf(task({ project: { id: "p1", name: "Atlante PDF" } }))).toEqual({
      label: "Atlante PDF",
      kind: "project",
      company: null,
    });
  });

  it("il progetto di riferimento vale come il progetto proprio", () => {
    // Ticket e occorrenze di un canone a contratto: appartengono altrove ma
    // fanno capo a un progetto.
    expect(taskReferenceOf(task({ relatedProject: { id: "p2", name: "Manutenzione" } }))).toEqual({
      label: "Manutenzione",
      kind: "project",
      company: null,
    });
  });

  it("l'offerta vince sul progetto: è il riferimento più preciso", () => {
    const ref = taskReferenceOf(
      task({
        relatedDeal: { id: "d1", title: "Rinnovo" },
        relatedProject: { id: "p1", name: "Manutenzione" },
      }),
    );
    expect(ref.kind).toBe("deal");
  });

  it("un'azienda senza offerta né progetto si mostra lo stesso", () => {
    const ref = taskReferenceOf(task({ company: { id: "c1", name: "NSA" } }));
    expect(ref).toEqual({ label: null, kind: null, company: "NSA" });
    expect(hasTaskReference(ref)).toBe(true);
  });

  it("un task che non fa capo a niente non occupa spazio", () => {
    expect(hasTaskReference(taskReferenceOf(task()))).toBe(false);
  });
});
