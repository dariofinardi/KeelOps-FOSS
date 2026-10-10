// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { NotificationType, TaskKind } from "@kancrm/shared";
import { notificationDestination, recordTargetOf } from "./record-target";

describe("dove porta un riferimento a un record", () => {
  it("un'offerta apre il pannello dell'offerta", () => {
    expect(recordTargetOf("t1", TaskKind.DEAL)).toBe("deal");
  });

  it("un ticket apre il pannello del ticket", () => {
    expect(recordTargetOf("t1", TaskKind.TICKET)).toBe("ticket");
  });

  it("scadenzario, progetti e personali aprono il task", () => {
    for (const kind of [TaskKind.ADMIN, TaskKind.PROJECT, TaskKind.PERSONAL]) {
      expect(recordTargetOf("t1", kind), kind).toBe("task");
    }
  });

  it("un tipo sconosciuto o mancante non blocca l'apertura", () => {
    // Il tipo arriva dal server come stringa: meglio aprire il task che restare
    // fermi su una notifica che parla di qualcosa.
    expect(recordTargetOf("t1", "QUALCOSA_DI_NUOVO")).toBe("task");
    expect(recordTargetOf("t1", null)).toBe("task");
  });

  it("senza riferimento non si apre niente", () => {
    // Le notifiche di riepilogo ("3 scadenze oggi") non rimandano a un record.
    expect(recordTargetOf(null, TaskKind.ADMIN)).toBeNull();
  });
});

describe("dove porta una notifica", () => {
  const notifica = (over: Record<string, unknown> = {}) => ({
    taskId: "t1",
    taskKind: TaskKind.ADMIN as string,
    type: NotificationType.TASK_ASSIGNED as string,
    ...over,
  });

  it("se parla di un record, lo apre", () => {
    expect(notificationDestination(notifica())).toEqual({
      kind: "record",
      taskId: "t1",
      target: "task",
    });
    expect(notificationDestination(notifica({ taskKind: TaskKind.DEAL }))).toMatchObject({
      target: "deal",
    });
  });

  it("il riepilogo scadenze porta all'agenda", () => {
    // Non ha un task solo da aprire, ma non per questo deve restare cieco.
    expect(
      notificationDestination({
        taskId: null,
        taskKind: null,
        type: NotificationType.DUE_DIGEST,
      }),
    ).toEqual({ kind: "route", path: "/bacheche" });
  });

  it("una notifica che non rimanda a niente resta ferma", () => {
    expect(
      notificationDestination({ taskId: null, taskKind: null, type: "qualcosa_di_nuovo" }),
    ).toBeNull();
  });
});

/**
 * **Il cliente del portale ha un pannello solo.**
 *
 * L'elenco dei ticket lo rispettava già; la campanella no, e su una richiesta
 * nata come task di progetto gli apriva il pannello interno — con progetto,
 * assegnatario, supervisore e storico (02/09/2026).
 */
describe("dove porta una notifica a un cliente del portale", () => {
  it("sempre alla sua richiesta, anche quando il record è un task di progetto", () => {
    expect(recordTargetOf("t1", "PROJECT", true)).toBe("ticket");
    expect(recordTargetOf("t1", "TICKET", true)).toBe("ticket");
    // controprova: per un interno lo stesso record è un task
    expect(recordTargetOf("t1", "PROJECT", false)).toBe("task");
  });

  it("e la notifica cliccata apre quello, non il pannello interno", () => {
    const avviso = { taskId: "t1", taskKind: "PROJECT", type: "ticket_update" };
    expect(notificationDestination(avviso, true)).toEqual({
      kind: "record",
      taskId: "t1",
      target: "ticket",
    });
    expect(notificationDestination(avviso, false)).toEqual({
      kind: "record",
      taskId: "t1",
      target: "task",
    });
  });
});
