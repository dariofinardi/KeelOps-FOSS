import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { AttachmentType, TaskKind, UserRole } from "@kancrm/shared";

/**
 * **Gli allegati prestati ai plugin** seguono la regola di accesso del core:
 * chi vede il task legge il file (testo estratto e, a richiesta, i byte);
 * chi non lo vede riceve un rifiuto; un collegamento resta un indirizzo.
 */
const { tempDir } = prepareTestDb("plugin-attachments");
const { prisma } = await import("../src/db");
const { attachmentStore } = await import("../src/modules/attachments/store");
const { leggiAllegatoPerPlugin, notaCollegamento, puoModificareTaskPerPlugin, scriviAllegatoPerPlugin } =
  await import("../src/plugins/plugin-attachments");

let admin: string;
let estraneo: string;
let fileId: string;
let linkId: string;
let taskId: string;

beforeAll(async () => {
  admin = (
    await prisma.user.create({ data: { email: "a@x.local", name: "Ada", role: UserRole.ADMIN } })
  ).id;
  estraneo = (
    await prisma.user.create({
      data: { email: "e@x.local", name: "Ettore", role: UserRole.MEMBER },
    })
  ).id;
  const status = await prisma.taskStatus.findFirstOrThrow({ where: { isClosed: false } });
  // un'offerta dell'admin: un membro che non ne fa parte non la vede
  const task = await prisma.task.create({
    data: {
      title: "Offerta con allegati",
      kind: TaskKind.DEAL,
      creatorId: admin,
      assigneeId: admin,
      statusId: status.id,
    },
  });
  taskId = task.id;
  await attachmentStore().write(
    `${task.id}/note.txt`,
    Buffer.from("Preventivo: 3 giornate a 600 €", "utf8"),
  );
  fileId = (
    await prisma.attachment.create({
      data: {
        type: AttachmentType.FILE,
        name: "note.txt",
        mimeType: "text/plain",
        size: 30,
        path: `${task.id}/note.txt`,
        uploadedById: admin,
        tasks: { create: { taskId: task.id } },
      },
    })
  ).id;
  linkId = (
    await prisma.attachment.create({
      data: {
        type: AttachmentType.LINK,
        name: "Cartella Drive",
        url: "https://drive.example/x",
        uploadedById: admin,
        tasks: { create: { taskId: task.id } },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("leggiAllegatoPerPlugin", () => {
  it("consegna testo e, a richiesta, i byte a chi vede il task", async () => {
    const solo = await leggiAllegatoPerPlugin(admin, fileId);
    expect(solo.text).toContain("3 giornate");
    expect(solo.bytes).toBeNull();
    const conByte = await leggiAllegatoPerPlugin(admin, fileId, { bytes: true });
    expect(conByte.bytes?.toString("utf8")).toContain("600 €");
    expect(conByte.mimeType).toBe("text/plain");
  });

  it("un collegamento resta un indirizzo", async () => {
    const link = await leggiAllegatoPerPlugin(admin, linkId);
    expect(link.url).toBe("https://drive.example/x");
    expect(link.text).toBeNull();
    // e dice che serve il connettore autorizzato: senza, non è un difetto nostro
    expect(link.saltato).toMatch(/connettore/);
    const drive = notaCollegamento("https://drive.google.com/file/d/abc/view");
    expect(drive).toMatch(/Google Drive/);
    expect(drive).toMatch(/autorizzato/);
  });

  it("chi non vede il task non legge l'allegato", async () => {
    await expect(leggiAllegatoPerPlugin(estraneo, fileId)).rejects.toThrow();
  });
});

/**
 * **Scrivere un allegato per conto di un plugin**: il permesso è quello del
 * core (chi può modificare il task), la sostituzione tiene lo stesso id — un
 * documento rigenerato non deve lasciare una seconda copia con lo stesso nome
 * — e il file vecchio esce dal magazzino solo dopo che il nuovo è registrato.
 */
describe("scriviAllegatoPerPlugin", () => {
  it("crea l'allegato a nome di chi può modificare il task", async () => {
    const esito = await scriviAllegatoPerPlugin("prova", admin, taskId, {
      name: "Preventivo.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: Buffer.from("PK-finto-uno"),
    });
    expect(esito.sostituito).toBe(false);
    const riga = await prisma.attachment.findUniqueOrThrow({ where: { id: esito.id } });
    expect(riga.name).toBe("Preventivo.docx");
    expect(riga.uploadedById).toBe(admin);
    expect(await attachmentStore().read(riga.path!)).toEqual(Buffer.from("PK-finto-uno"));
    // e l'attività resta nel registro del task, come un caricamento qualsiasi
    const attivita = await prisma.activityLog.findFirst({
      where: { taskId, action: "attachment_added" },
      orderBy: { createdAt: "desc" },
    });
    expect(attivita).not.toBeNull();
  });

  it("sostituisce tenendo lo stesso id, e toglie il file di prima", async () => {
    const primo = await scriviAllegatoPerPlugin("prova", admin, taskId, { name: "Offerta.docx", bytes: Buffer.from("versione-1") });
    const vecchioPath = (await prisma.attachment.findUniqueOrThrow({ where: { id: primo.id } })).path!;
    const secondo = await scriviAllegatoPerPlugin("prova", admin, taskId, {
      name: "Offerta.docx",
      bytes: Buffer.from("versione-2-piu-lunga"),
      replaceAttachmentId: primo.id,
    });
    expect(secondo.id).toBe(primo.id);
    expect(secondo.sostituito).toBe(true);
    const riga = await prisma.attachment.findUniqueOrThrow({ where: { id: primo.id } });
    expect(riga.size).toBe("versione-2-piu-lunga".length);
    expect(await attachmentStore().read(riga.path!)).toEqual(Buffer.from("versione-2-piu-lunga"));
    await expect(attachmentStore().read(vecchioPath)).rejects.toThrow();
    // un solo allegato con quel nome: la sostituzione non ne affianca un altro
    const quanti = await prisma.attachment.count({ where: { name: "Offerta.docx", tasks: { some: { taskId } } } });
    expect(quanti).toBe(1);
  });

  it("rifiuta chi il task non lo può modificare, e non lascia file in giro", async () => {
    const prima = (await prisma.attachment.count({ where: { tasks: { some: { taskId } } } }));
    await expect(
      scriviAllegatoPerPlugin("prova", estraneo, taskId, { name: "Abusivo.docx", bytes: Buffer.from("x") }),
    ).rejects.toThrow(/non puoi modificare/);
    expect(await prisma.attachment.count({ where: { tasks: { some: { taskId } } } })).toBe(prima);
  });

  it("non sostituisce un allegato che non è di questo task", async () => {
    const altro = await prisma.task.create({
      data: { title: "Altro", kind: TaskKind.DEAL, creatorId: admin, assigneeId: admin },
    });
    const suo = await scriviAllegatoPerPlugin("prova", admin, altro.id, { name: "Suo.docx", bytes: Buffer.from("suo") });
    const esito = await scriviAllegatoPerPlugin("prova", admin, taskId, {
      name: "Nuovo.docx",
      bytes: Buffer.from("nuovo"),
      replaceAttachmentId: suo.id,
    });
    expect(esito.id).not.toBe(suo.id);
    expect(esito.sostituito).toBe(false);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: suo.id } })).name).toBe("Suo.docx");
  });

  it("puoModificareTaskPerPlugin risponde secco, senza eccezioni", async () => {
    expect(await puoModificareTaskPerPlugin(admin, taskId)).toBe(true);
    expect(await puoModificareTaskPerPlugin(estraneo, taskId)).toBe(false);
    expect(await puoModificareTaskPerPlugin(admin, "non-esiste")).toBe(false);
    expect(await puoModificareTaskPerPlugin("non-esiste", taskId)).toBe(false);
  });
});
