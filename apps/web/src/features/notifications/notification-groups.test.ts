import { describe, expect, it } from "vitest";
import { NotificationType, type NotificationDto } from "@kancrm/shared";
import { groupNotifications } from "./notification-groups";

const nota = (
  id: string,
  createdAt: string,
  taskId: string | null,
  readAt: string | null = null,
): NotificationDto => ({
  id,
  type: NotificationType.TASK_COMMENT,
  text: `notifica ${id}`,
  taskId,
  taskKind: taskId ? "PROJECT" : null,
  readAt,
  createdAt,
});

describe("raggruppamento delle notifiche", () => {
  it("dello stesso task resta solo l'ultima, che dice quante ne vale", () => {
    const gruppi = groupNotifications([
      nota("c", "2026-08-27T17:28:00Z", "t1"),
      nota("b", "2026-08-27T17:14:00Z", "t1"),
      nota("a", "2026-08-27T16:27:00Z", "t1"),
    ]);
    expect(gruppi).toHaveLength(1);
    expect(gruppi[0]!.latest.id).toBe("c");
    expect(gruppi[0]!.count).toBe(3);
    // gli id servono a segnarle lette TUTTE: il contatore non deve restare indietro
    expect(gruppi[0]!.ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("task diversi restano righe diverse, dalla più recente", () => {
    const gruppi = groupNotifications([
      nota("vecchia", "2026-08-27T09:00:00Z", "t1"),
      nota("nuova", "2026-08-27T18:00:00Z", "t2"),
    ]);
    expect(gruppi.map((g) => g.latest.id)).toEqual(["nuova", "vecchia"]);
  });

  it("chi non parla di un task non si raggruppa mai", () => {
    // il riepilogo scadenze e gli avvisi di sistema non hanno un record dietro
    const gruppi = groupNotifications([
      nota("d1", "2026-08-27T08:00:00Z", null),
      nota("d2", "2026-08-26T08:00:00Z", null),
    ]);
    expect(gruppi).toHaveLength(2);
  });

  it("conta le non lette del gruppo, non solo quella in cima", () => {
    const gruppi = groupNotifications([
      nota("c", "2026-08-27T17:00:00Z", "t1"),
      nota("b", "2026-08-27T16:00:00Z", "t1", "2026-08-27T16:30:00Z"),
      nota("a", "2026-08-27T15:00:00Z", "t1"),
    ]);
    expect(gruppi[0]!.unread).toBe(2);
  });

  it("l'ordine di arrivo non conta: vince la data", () => {
    const gruppi = groupNotifications([
      nota("vecchia", "2026-08-01T10:00:00Z", "t1"),
      nota("recente", "2026-08-27T10:00:00Z", "t1"),
    ]);
    expect(gruppi[0]!.latest.id).toBe("recente");
  });
});
