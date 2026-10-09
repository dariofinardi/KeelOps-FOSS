import { describe, expect, it } from "vitest";
import { TaskKind, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("user-deletion-restrict");
const { prisma } = await import("../src/db");
const { deleteUser } = await import("../src/modules/users/deletion");
const { mergeUser } = await import("../src/modules/users/migration");

/**
 * **Le chiavi che bloccano la cancellazione di un utente** (08/10/2026). Il
 * nucleo conosce lo schema intero e deve occuparsi anche delle righe dei
 * moduli commerciali: ci possono essere — anche in una community avviata su un
 * database commerciale. Prima l'analisi di un'offerta vinta faceva fallire
 * l'eliminazione e la fusione di chi l'aveva chiesta (errore di chiave esterna),
 * e l'utente di servizio di un modulo iniettabile dava un 500 invece di dire
 * perché.
 */
let n = 0;
const persona = (role: string = UserRole.MEMBER) =>
  prisma.user.create({ data: { email: `u${n++}@test.local`, name: `U${n}`, role } });

const offertaConAnalisi = async (richiedenteId: string) => {
  const offerta = await prisma.task.create({
    data: { kind: TaskKind.DEAL, title: "Offerta vinta", creatorId: richiedenteId },
  });
  return prisma.dealAnalysis.create({ data: { dealId: offerta.id, requestedById: richiedenteId } });
};

describe("cancellazione e fusione con righe dei moduli", () => {
  it("l'analisi di un'offerta passa a chi riceve i dati di chi viene eliminato", async () => {
    const admin = await persona(UserRole.ADMIN);
    const commerciale = await persona();
    const erede = await persona();
    const analisi = await offertaConAnalisi(commerciale.id);
    await deleteUser(commerciale.id, admin.id, erede.id);
    expect(await prisma.user.findUnique({ where: { id: commerciale.id } })).toBeNull();
    expect(
      (await prisma.dealAnalysis.findUniqueOrThrow({ where: { id: analisi.id } })).requestedById,
    ).toBe(erede.id);
  });

  it("chi ha solo un'analisi ha dei dati: serve un destinatario", async () => {
    const admin = await persona(UserRole.ADMIN);
    const commerciale = await persona();
    const altro = await persona();
    const offerta = await prisma.task.create({
      data: { kind: TaskKind.DEAL, title: "Offerta di un altro", creatorId: altro.id },
    });
    await prisma.dealAnalysis.create({
      data: { dealId: offerta.id, requestedById: commerciale.id },
    });
    await expect(deleteUser(commerciale.id, admin.id, null)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("la fusione porta con sé anche le analisi", async () => {
    const doppione = await persona();
    const vero = await persona();
    const analisi = await offertaConAnalisi(doppione.id);
    await mergeUser(doppione, vero);
    expect(
      (await prisma.dealAnalysis.findUniqueOrThrow({ where: { id: analisi.id } })).requestedById,
    ).toBe(vero.id);
  });

  it("l'utente di servizio di un modulo iniettabile non si elimina, e lo si dice", async () => {
    const admin = await persona(UserRole.ADMIN);
    const servizio = await persona();
    await prisma.injectClient.create({
      data: {
        name: "Orione Cloud",
        publicKey: "pk-test",
        origins: "[]",
        serviceUserId: servizio.id,
      },
    });
    await expect(deleteUser(servizio.id, admin.id, null)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Orione Cloud"),
    });
  });

  it("la fusione sposta il modulo iniettabile sull'utente che resta", async () => {
    const doppione = await persona();
    const vero = await persona();
    const cliente = await prisma.injectClient.create({
      data: { name: "Atlante", publicKey: "pk-test-2", origins: "[]", serviceUserId: doppione.id },
    });
    await mergeUser(doppione, vero);
    expect(
      (await prisma.injectClient.findUniqueOrThrow({ where: { id: cliente.id } })).serviceUserId,
    ).toBe(vero.id);
  });
});
