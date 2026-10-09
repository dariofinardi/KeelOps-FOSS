import { describe, expect, it } from "vitest";
import { UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("attachment-template-roles");
const { prisma } = await import("../src/db");
const { assertAttachmentDownloadAccess } = await import("../src/modules/attachments/routes");

/**
 * **Gli allegati-modello delle ricorrenze sono roba interna** (fissato
 * l'08/10/2026, quando il controllo è passato da «né portale né monitor» a
 * «ruolo del nucleo»): li apre un interno, non un cliente del portale né un
 * monitor vendite.
 */
describe("allegati-modello delle ricorrenze", () => {
  it("li apre un interno, non il portale né il monitor vendite", async () => {
    const persona = (email: string, role: string) =>
      prisma.user.create({ data: { email, name: email, role } });
    const interno = await persona("interno@test.local", UserRole.MEMBER);
    const cliente = await persona("cliente@test.local", UserRole.PORTAL);
    const monitor = await persona("monitor@test.local", UserRole.SALES_MONITOR);
    const modello = await prisma.recurrenceTemplate.create({
      data: {
        title: "F24 mensile",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=16",
        dtstart: new Date("2026-01-16T00:00:00.000Z"),
        creatorId: interno.id,
      },
    });
    const allegato = await prisma.attachment.create({
      data: {
        type: "LINK",
        name: "Istruzioni",
        url: "https://example.com/istruzioni",
        uploadedById: interno.id,
      },
    });
    await prisma.recurrenceTemplateAttachment.create({
      data: { templateId: modello.id, attachmentId: allegato.id },
    });

    await expect(assertAttachmentDownloadAccess(interno, allegato.id)).resolves.toBeUndefined();
    await expect(assertAttachmentDownloadAccess(cliente, allegato.id)).rejects.toThrow();
    await expect(assertAttachmentDownloadAccess(monitor, allegato.id)).rejects.toThrow();
  });
});
