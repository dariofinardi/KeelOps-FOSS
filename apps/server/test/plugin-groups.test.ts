import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityCategory, UserRole } from "@kancrm/shared";
import { prepareTestDb } from "./support/test-db";

/**
 * **I gruppi prestati ai plugin** (22/09/2026). Un plugin che governa un
 * mestiere deve poter dire chi lo fa: crea il suo gruppo una volta, marcato
 * col suo nick, e da lì in poi comanda l'amministratore.
 *
 * Le prove guardano soprattutto tre cose che sarebbe facile sbagliare: che
 * chiamarlo due volte non faccia due gruppi, che rinominarlo non lo faccia
 * perdere al plugin, e che il marchio **resti** su ciò che il plugin crea nel
 * core — perché è la sola cosa che permetterà di disinstallarlo sapendo cosa
 * si tocca.
 */
const { tempDir } = prepareTestDb("plugin-groups");
const { prisma } = await import("../src/db");
const {
  assicuraGruppoPerPlugin,
  inventarioDelPlugin,
  leggiGruppoDelPlugin,
  membriGruppoDelPlugin,
  utenteNelGruppoDelPlugin,
} = await import("../src/plugins/plugin-groups");
const { creaTaskPerPlugin } = await import("../src/plugins/plugin-tasks");

const ids: Record<string, string> = {};

beforeAll(async () => {
  for (const [k, role] of [
    ["capo", UserRole.ADMIN],
    ["anna", UserRole.MEMBER],
    ["bruno", UserRole.MEMBER],
  ] as const) {
    ids[k] = (
      await prisma.user.create({
        data: {
          email: `${k}@x.local`,
          name: k,
          role,
          ...(k === "capo" ? { adminUntil: new Date("2099-01-01") } : {}),
        },
      })
    ).id;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("assicuraGruppoPerPlugin", () => {
  it("crea il gruppo una volta sola, con l'area che governa", async () => {
    const primo = await assicuraGruppoPerPlugin("qabox", {
      chiave: "qualita",
      nome: "Qualità",
      area: ActivityCategory.QUALITY,
    });
    expect(primo.origine).toBe("creato");
    expect(primo.area).toBe("QUALITY");

    const secondo = await assicuraGruppoPerPlugin("qabox", {
      chiave: "qualita",
      nome: "Qualità",
      area: ActivityCategory.QUALITY,
    });
    expect(secondo.origine).toBe("esistente");
    expect(secondo.id).toBe(primo.id);
    expect(await prisma.group.count({ where: { pluginNick: "qabox" } })).toBe(1);
  });

  it("il gruppo resta del plugin anche dopo che l'amministratore lo rinomina", async () => {
    const creato = await assicuraGruppoPerPlugin("qabox", { chiave: "qualita", nome: "Qualità" });
    await prisma.group.update({ where: { id: creato.id }, data: { name: "Controllo qualità" } });

    const ritrovato = await leggiGruppoDelPlugin("qabox", "qualita");
    expect(ritrovato?.id).toBe(creato.id);
    expect(ritrovato?.nome).toBe("Controllo qualità");
    // e chiamarlo di nuovo non ne fabbrica un secondo col nome vecchio
    const ancora = await assicuraGruppoPerPlugin("qabox", { chiave: "qualita", nome: "Qualità" });
    expect(ancora.id).toBe(creato.id);
    expect(await prisma.group.count({ where: { pluginNick: "qabox" } })).toBe(1);
  });

  it("adotta il gruppo che una persona aveva già fatto con quel nome", async () => {
    const aMano = await prisma.group.create({ data: { name: "Manutenzione" } });
    await prisma.groupMember.create({
      data: { groupId: aMano.id, userId: ids.anna!, isManager: true },
    });
    const adottato = await assicuraGruppoPerPlugin("maint", {
      chiave: "squadra",
      nome: "Manutenzione",
      area: ActivityCategory.GENERAL,
    });
    expect(adottato.origine).toBe("adottato");
    expect(adottato.id).toBe(aMano.id);
    // i membri non si toccano: il marchio è l'unica cosa che cambia
    const membri = await membriGruppoDelPlugin("maint", "squadra");
    expect(membri).toEqual([{ id: ids.anna, name: "anna", isManager: true }]);
    expect(await prisma.group.count({ where: { name: "Manutenzione" } })).toBe(1);
  });

  it("un'area già scelta da una persona non viene sovrascritta dall'adozione", async () => {
    await prisma.group.create({ data: { name: "Amministrazione", managedArea: "ADMIN" } });
    const adottato = await assicuraGruppoPerPlugin("conti", {
      chiave: "ammin",
      nome: "Amministrazione",
      area: ActivityCategory.DEV,
    });
    expect(adottato.area).toBe("ADMIN");
  });

  it("non ruba il gruppo di un altro plugin, e rifiuta chiavi e aree inventate", async () => {
    await assicuraGruppoPerPlugin("primo", { chiave: "suo", nome: "Conteso" });
    await expect(
      assicuraGruppoPerPlugin("secondo", { chiave: "mio", nome: "Conteso" }),
    ).rejects.toThrow(/è già del plugin primo/);
    await expect(
      assicuraGruppoPerPlugin("qabox", { chiave: "Non Valida!", nome: "X" }),
    ).rejects.toThrow(/non valida/);
    await expect(
      assicuraGruppoPerPlugin("qabox", { chiave: "x", nome: "Y", area: "MARKETING" }),
    ).rejects.toThrow(/sconosciuta/);
    await expect(assicuraGruppoPerPlugin(null, { chiave: "x", nome: "Y" })).rejects.toThrow(
      /vuole il nick/,
    );
    await expect(assicuraGruppoPerPlugin("qabox", { chiave: "x", nome: "  " })).rejects.toThrow(
      /vuole un nome/,
    );
  });

  it("un gruppo cancellato non risorge da sé: il plugin lo trova mancante", async () => {
    const creato = await assicuraGruppoPerPlugin("effimero", { chiave: "suo", nome: "Effimero" });
    await prisma.group.delete({ where: { id: creato.id } });
    expect(await leggiGruppoDelPlugin("effimero", "suo")).toBeNull();
    expect(await membriGruppoDelPlugin("effimero", "suo")).toEqual([]);
  });

  it("dice chi sta nel gruppo: è quello che decide la voce nel menù", async () => {
    const gruppo = await assicuraGruppoPerPlugin("qabox", { chiave: "qualita", nome: "Qualità" });
    await prisma.groupMember.create({
      data: { groupId: gruppo.id, userId: ids.bruno!, isManager: false },
    });
    expect(await utenteNelGruppoDelPlugin("qabox", ids.bruno!)).toBe(true);
    expect(await utenteNelGruppoDelPlugin("qabox", ids.anna!)).toBe(false);
  });
});

describe("il marchio su ciò che il plugin lascia nel core", () => {
  it("un task creato da un plugin dice da quale, e con quale riferimento", async () => {
    const task = await creaTaskPerPlugin("qabox", ids.anna!, {
      title: "NC-2026-001 · pH fuori limite",
      ref: "nc-123",
    });
    expect(task.pluginNick).toBe("qabox");
    expect(task.pluginRef).toBe("nc-123");
    const riga = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(riga.pluginNick).toBe("qabox");
  });

  it("un task nato in KeelOps non porta marchio", async () => {
    const task = await creaTaskPerPlugin(null, ids.anna!, { title: "Senza plugin" });
    expect(task.pluginNick).toBeNull();
  });

  it("l'inventario risponde alla domanda «cosa ha lasciato questo plugin?»", async () => {
    const conto = await inventarioDelPlugin("qabox");
    expect(conto.gruppi).toBe(1);
    expect(conto.task).toBeGreaterThanOrEqual(1);
    expect(conto.allegati).toBe(0);
    expect(await inventarioDelPlugin("mai-installato")).toEqual({
      nick: "mai-installato",
      gruppi: 0,
      task: 0,
      allegati: 0,
    });
  });
});
