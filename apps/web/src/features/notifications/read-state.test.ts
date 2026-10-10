// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { NotificationList } from "@kancrm/shared";
import { segnaLette, segnaTutteLette } from "./read-state";

const notifica = (id: string, readAt: string | null): NotificationList["notifications"][number] => ({
  id,
  type: "mention",
  text: `avviso ${id}`,
  taskId: null,
  taskKind: null,
  readAt,
  createdAt: "2026-09-04T09:00:00.000Z",
});

const elenco: NotificationList = {
  notifications: [notifica("a", null), notifica("b", null), notifica("c", "2026-09-04T08:00:00.000Z")],
  // Più di quante se ne vedono: la lista sono le ultime cinquanta, il contatore
  // le comprende tutte.
  unreadCount: 12,
};

describe("la spunta, prima che risponda il server", () => {
  it("segna quelle indicate e scala il contatore di altrettante", () => {
    const dopo = segnaLette(elenco, ["a", "b"], "2026-09-04T10:00:00.000Z")!;
    expect(dopo.notifications.map((n) => n.readAt)).toEqual([
      "2026-09-04T10:00:00.000Z",
      "2026-09-04T10:00:00.000Z",
      "2026-09-04T08:00:00.000Z",
    ]);
    expect(dopo.unreadCount).toBe(10);
  });

  it("una già letta non si conta due volte", () => {
    // Due clic sulla stessa riga, o la riga letta altrove un istante prima:
    // il contatore non deve scendere di uno per un lavoro già fatto.
    expect(segnaLette(elenco, ["c"])!.unreadCount).toBe(12);
  });

  it("un id che non è nella lista non tocca niente", () => {
    expect(segnaLette(elenco, ["zzz"])!.unreadCount).toBe(12);
  });

  it("il contatore non va sotto zero", () => {
    const quasi: NotificationList = { ...elenco, unreadCount: 1 };
    expect(segnaLette(quasi, ["a", "b"])!.unreadCount).toBe(0);
  });

  it("tutte lette azzera anche ciò che non si vede", () => {
    const dopo = segnaTutteLette(elenco)!;
    expect(dopo.notifications.every((n) => n.readAt !== null)).toBe(true);
    expect(dopo.unreadCount).toBe(0);
  });

  it("senza elenco in cache non inventa niente", () => {
    expect(segnaLette(undefined, ["a"])).toBeUndefined();
    expect(segnaTutteLette(undefined)).toBeUndefined();
  });
});
