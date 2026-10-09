import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { AttachmentType, UserRole } from "@kancrm/shared";

/**
 * **Il file allegato a un messaggio.**
 *
 * L'allegato resta del task — è lì che si cerca, mesi dopo — e il messaggio dice
 * con quale frase è arrivato. Le due cose che contano qui: si allega **solo ciò
 * che è già di questo task** (l'identificativo lo si può scrivere a mano, e
 * senza il controllo si mostrerebbe dentro un messaggio il documento di un task
 * che chi legge non può nemmeno aprire), e un allegato **da solo è un
 * messaggio** — «ecco il file» non ha bisogno di parole sopra.
 */
const { tempDir } = prepareTestDb("comment-attachments");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let cookie = "";
let taskId = "";
let altroTaskId = "";
let userId = "";

/** Un allegato già registrato su un task, come dopo un caricamento. */
const allegaAlTask = async (taskId: string, name: string): Promise<string> => {
  const creato = await prisma.attachment.create({
    data: {
      type: AttachmentType.FILE,
      name,
      path: `${taskId}/${name}`,
      mimeType: "application/pdf",
      size: 1024,
      uploadedById: userId,
      tasks: { create: { taskId } },
    },
  });
  return creato.id;
};

beforeAll(async () => {
  await prisma.taskStatus.create({
    data: { name: "Da fare", category: "ADMIN", color: "#888", order: 0 },
  });
  const user = await prisma.user.create({
    data: {
      email: "dario@test.local",
      name: "Dario Ferri",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: await hashPassword("dario1234"),
    },
  });
  userId = user.id;
  app = await buildApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "dario@test.local", password: "dario1234" },
  });
  cookie = `${SESSION_COOKIE}=${login.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  const crea = async (title: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: { cookie },
        payload: { title },
      })
    ).json().id as string;
  taskId = await crea("Deformattazione PDF");
  altroTaskId = await crea("Un altro lavoro");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

const scrivi = (body: string, attachmentIds?: string[]) =>
  app.inject({
    method: "POST",
    url: `/api/tasks/${taskId}/comments`,
    headers: { cookie },
    payload: { body, ...(attachmentIds ? { attachmentIds } : {}) },
  });

describe("allegati di un messaggio", () => {
  it("il file arrivato col messaggio si legge accanto al messaggio", async () => {
    const allegatoId = await allegaAlTask(taskId, "preventivo.pdf");
    const risposta = await scrivi("ecco il preventivo aggiornato", [allegatoId]);
    expect(risposta.statusCode).toBe(201);
    expect(risposta.json().attachments).toHaveLength(1);
    expect(risposta.json().attachments[0].name).toBe("preventivo.pdf");

    // e rileggendo la conversazione, non solo nella risposta all'invio
    const elenco = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/comments`,
      headers: { cookie },
    });
    expect(elenco.json().items[0].attachments[0].name).toBe("preventivo.pdf");
  });

  it("un allegato di un ALTRO task non si aggancia", async () => {
    const estraneo = await allegaAlTask(altroTaskId, "contratto-di-altri.pdf");
    const risposta = await scrivi("guarda qui", [estraneo]);
    expect(risposta.statusCode).toBe(201);
    // Il messaggio parte lo stesso, ma senza quel documento: l'identificativo
    // si può scrivere a mano, e questo è il punto in cui non serve a niente.
    expect(risposta.json().attachments).toEqual([]);
  });

  it("un allegato da solo è un messaggio: nessuna parola richiesta", async () => {
    const allegatoId = await allegaAlTask(taskId, "verbale.pdf");
    const risposta = await scrivi("", [allegatoId]);
    expect(risposta.statusCode).toBe(201);
    expect(risposta.json().body).toBe("");
    expect(risposta.json().attachments).toHaveLength(1);
  });

  it("ma un messaggio vuoto senza allegati non è niente", async () => {
    expect((await scrivi("   ")).statusCode).toBe(400);
  });

  /**
   * **Il file arrivato con un messaggio se ne va con il messaggio** (deciso il
   * 04/09/2026, prima restava negli allegati). Sono la stessa cosa per chi
   * legge — «ciapa l'allegato!» e il documento sotto — e tenere il file dopo
   * aver cancellato la frase che lo spiegava vuol dire tenere un documento che
   * nessuno sa più cosa sia.
   */
  it("cancellare il messaggio porta via anche il suo allegato", async () => {
    const allegatoId = await allegaAlTask(taskId, "da-ritirare.pdf");
    const commento = (await scrivi("te lo mando", [allegatoId])).json();
    const eliminato = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}/comments/${commento.id}`,
      headers: { cookie },
    });
    expect(eliminato.statusCode).toBe(204);
    expect(await prisma.commentAttachment.count({ where: { attachmentId: allegatoId } })).toBe(0);
    expect(await prisma.taskAttachment.count({ where: { attachmentId: allegatoId } })).toBe(0);
  });

  /**
   * **Dagli allegati non si toglie.** Chiunque possa modificare il task potrebbe
   * farlo, mentre il messaggio lo cancella solo chi l'ha scritto: le due regole
   * devono essere la stessa, o la più debole vince e la protezione non c'è.
   */
  it("l'allegato di un messaggio non si toglie dalla sezione allegati", async () => {
    const allegatoId = await allegaAlTask(taskId, "protetto.pdf");
    await scrivi("guarda qua", [allegatoId]);
    const tentativo = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}/attachments/${allegatoId}`,
      headers: { cookie },
    });
    expect(tentativo.statusCode).toBe(409);
    expect(tentativo.json().error).toBe("ATTACHMENT_FROM_COMMENT");
    expect(await prisma.taskAttachment.count({ where: { attachmentId: allegatoId } })).toBe(1);
  });

  it("un allegato caricato dalla sezione allegati si toglie come sempre", async () => {
    const allegatoId = await allegaAlTask(taskId, "libero.pdf");
    const tolto = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}/attachments/${allegatoId}`,
      headers: { cookie },
    });
    expect(tolto.statusCode).toBe(204);
  });

  it("il dettaglio del task dice da quale messaggio arriva ogni allegato", async () => {
    const dalMessaggio = await allegaAlTask(taskId, "con-messaggio.pdf");
    const commento = (await scrivi("eccolo", [dalMessaggio])).json();
    const daSolo = await allegaAlTask(taskId, "senza-messaggio.pdf");

    const dettaglio = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
      headers: { cookie },
    });
    const allegati = dettaglio.json().attachments as Array<{
      id: string;
      commentId: string | null;
    }>;
    expect(allegati.find((a) => a.id === dalMessaggio)?.commentId).toBe(commento.id);
    expect(allegati.find((a) => a.id === daSolo)?.commentId).toBeNull();
  });
});
