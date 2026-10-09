import { describe, expect, it } from "vitest";
import {
  NotificationType,
  notificationTypesFor,
  PORTAL_NOTIFICATION_TYPES,
} from "./schemas/notifications";

/**
 * Il pannello delle preferenze mostrava a un cliente del portale anche il
 * promemoria del timesheet e il limite WIP: avvisi che non lo raggiungeranno
 * mai, e che gli facevano credere di avere davanti il pannello di qualcun
 * altro. A lui restano le due cose che lo riguardano davvero.
 */
describe("quali avvisi si offrono a chi", () => {
  it("al cliente del portale: le sue richieste, e quando lo si cita", () => {
    expect(notificationTypesFor("PORTAL")).toEqual([
      NotificationType.TICKET_UPDATE,
      NotificationType.MENTION,
    ]);
  });

  it("a chi lavora in azienda: tutti, nessuno escluso", () => {
    expect(notificationTypesFor("MEMBER")).toEqual(Object.values(NotificationType));
    expect(notificationTypesFor("ADMIN").length).toBeGreaterThan(PORTAL_NOTIFICATION_TYPES.length);
  });

  it("ogni tipo offerto al cliente ha la sua etichetta", async () => {
    const { NOTIFICATION_TYPE_LABELS } = await import("./schemas/notifications");
    for (const tipo of PORTAL_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_LABELS[tipo]).toBeTruthy();
    }
  });
});
