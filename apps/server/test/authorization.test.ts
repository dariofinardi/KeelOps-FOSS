import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { AttachmentType, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("authz");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { signDownloadToken, verifyDownloadToken } =
  await import("../src/modules/attachments/download-token");
const { sweepOrphanAttachments, attachmentAbsolutePath } =
  await import("../src/modules/attachments/storage");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const PW = "password-di-prova-1";
let userA = { id: "" };
let statusId = "";

// Una sola login per utente (il login è rate-limited): la sessione si riusa.
const cookies = new Map<string, string>();
async function cookie(email: string): Promise<string> {
  const cached = cookies.get(email);
  if (cached) return cached;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: PW },
  });
  const value = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const header = `${SESSION_COOKIE}=${value}`;
  cookies.set(email, header);
  return header;
}

beforeAll(async () => {
  const hash = await hashPassword(PW);
  await prisma.user.create({
    data: {
      email: "admin@authz.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"),
      passwordHash: hash,
    },
  });
  userA = await prisma.user.create({
    data: { email: "a@authz.local", name: "Utente A", role: UserRole.MEMBER, passwordHash: hash },
  });
  await prisma.user.create({
    data: { email: "b@authz.local", name: "Utente B", role: UserRole.MEMBER, passwordHash: hash },
  });
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  statusId = status.id;
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

// Crea un task ADMIN di A con un allegato-file reale su disco. Ritorna gli id e
// il percorso relativo del file.
async function taskWithFile(): Promise<{ taskId: string; attachmentId: string; rel: string }> {
  const task = await prisma.task.create({
    data: { title: "Con allegato", statusId, creatorId: userA.id, assigneeId: userA.id },
  });
  const attachment = await prisma.attachment.create({
    data: { type: AttachmentType.FILE, name: "nota.txt", uploadedById: userA.id },
  });
  const rel = path.join(task.id, `${attachment.id}-nota.txt`);
  await mkdir(path.dirname(attachmentAbsolutePath(rel)), { recursive: true });
  writeFileSync(attachmentAbsolutePath(rel), "contenuto segreto");
  await prisma.attachment.update({ where: { id: attachment.id }, data: { path: rel } });
  await prisma.taskAttachment.create({ data: { taskId: task.id, attachmentId: attachment.id } });
  return { taskId: task.id, attachmentId: attachment.id, rel };
}

describe("token di download (modulo)", () => {
  it("firma e verifica lo stesso id", () => {
    const now = 1_000_000;
    expect(verifyDownloadToken(signDownloadToken("att-1", now), now + 1000)).toBe("att-1");
  });
  it("rifiuta un token scaduto", () => {
    const now = 1_000_000;
    const token = signDownloadToken("att-1", now);
    expect(verifyDownloadToken(token, now + 10 * 60 * 1000)).toBeNull();
  });
  it("rifiuta un token manomesso", () => {
    const token = signDownloadToken("att-1");
    expect(verifyDownloadToken(`${token}x`)).toBeNull();
    expect(verifyDownloadToken("qualcosa.di.finto")).toBeNull();
  });
});

describe("download allegati a token", () => {
  it("A ottiene il token e scarica; senza permessi B riceve 404", async () => {
    const { attachmentId } = await taskWithFile();

    const tokenRes = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachmentId}/download-token`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { url } = tokenRes.json() as { url: string };

    // La rotta di streaming è pubblica: il token È l'autorizzazione.
    const fileRes = await app.inject({ method: "GET", url });
    expect(fileRes.statusCode).toBe(200);
    expect(fileRes.body).toContain("contenuto segreto");
    expect(fileRes.headers["content-disposition"]).toContain("nota.txt");

    // B non vede il task admin di A: niente token.
    const denied = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachmentId}/download-token`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("un token non valido non serve alcun file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/attachments/download/non-valido" });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * Punto unico di apertura: la UI non usa mai l'URL memorizzato, né per i file né
 * per i link. È qui che si innesteranno Workspace o un visualizzatore, quindi è
 * qui che devono passare tutti — e i permessi si controllano una volta sola.
 */
describe("apertura di un allegato (/open)", () => {
  it("un file diventa un URL di download firmato", async () => {
    const { attachmentId } = await taskWithFile();
    const res = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachmentId}/open`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("download");
    expect(res.json().name).toBe("nota.txt");
    // L'URL restituito è davvero servibile: niente indirizzi che non aprono nulla.
    const file = await app.inject({ method: "GET", url: res.json().url });
    expect(file.statusCode).toBe(200);
    expect(file.body).toContain("contenuto segreto");
  });

  it("un link diventa l'indirizzo esterno, ma solo per chi vede il task", async () => {
    const task = await prisma.task.create({
      data: { title: "Con link", statusId, creatorId: userA.id, assigneeId: userA.id },
    });
    const attachment = await prisma.attachment.create({
      data: {
        type: AttachmentType.LINK,
        name: "Contratto su Drive",
        url: "https://drive.google.com/contratto",
        uploadedById: userA.id,
      },
    });
    await prisma.taskAttachment.create({ data: { taskId: task.id, attachmentId: attachment.id } });

    const res = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachment.id}/open`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: "external",
      url: "https://drive.google.com/contratto",
    });

    // Prima l'indirizzo di un link non era protetto da nulla: bastava averlo.
    const denied = await app.inject({
      method: "GET",
      url: `/api/attachments/${attachment.id}/open`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("un link javascript: non passa: né in creazione né all'apertura", async () => {
    // z.string().url() da solo accetta javascript:, data: e file:. Un link così,
    // cliccato da un collega, eseguirebbe codice nella sua sessione — e i link
    // possono aggiungerli anche i clienti del portale, sui loro ticket.
    const task = await prisma.task.create({
      data: { title: "Con link ostile", statusId, creatorId: userA.id, assigneeId: userA.id },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/attachments/link`,
      headers: { cookie: await cookie("a@authz.local") },
      payload: { name: "Cliccami", url: "javascript:alert(document.cookie)" },
    });
    expect(rejected.statusCode).toBe(400);

    // Un link ostile già presente in archivio (import storici, versioni vecchie)
    // non deve comunque arrivare al browser di chi clicca.
    const legacy = await prisma.attachment.create({
      data: {
        type: AttachmentType.LINK,
        name: "Storico",
        url: "javascript:alert(1)",
        uploadedById: userA.id,
      },
    });
    await prisma.taskAttachment.create({ data: { taskId: task.id, attachmentId: legacy.id } });
    const open = await app.inject({
      method: "GET",
      url: `/api/attachments/${legacy.id}/open`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(open.statusCode).toBe(404);
  });

  it("un allegato inesistente non rivela nulla", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/attachments/non-esiste/open",
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("rimozione allegati e file", () => {
  it("B senza accesso non può staccare; A stacca senza cancellare il file", async () => {
    const { taskId, attachmentId, rel } = await taskWithFile();

    const denied = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}/attachments/${attachmentId}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}/attachments/${attachmentId}`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(ok.statusCode).toBe(204);

    // Scollegato dal task, ma record e file restano: il file muore solo alla
    // cancellazione definitiva.
    const link = await prisma.taskAttachment.findUnique({
      where: { taskId_attachmentId: { taskId, attachmentId } },
    });
    expect(link).toBeNull();
    expect(await prisma.attachment.findUnique({ where: { id: attachmentId } })).not.toBeNull();
    expect(existsSync(attachmentAbsolutePath(rel))).toBe(true);

    // Lo sweep (svuotamento/purge) rimuove ora l'orfano: record e file.
    const swept = await sweepOrphanAttachments();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await prisma.attachment.findUnique({ where: { id: attachmentId } })).toBeNull();
    expect(existsSync(attachmentAbsolutePath(rel))).toBe(false);
  });
});

describe("la citazione apre il task in sola lettura (31/08/2026)", () => {
  it("prima della menzione B non entra; dopo, legge e risponde ma non modifica", async () => {
    const task = await prisma.task.create({
      data: { title: "Riservato ad A", statusId, creatorId: userA.id, assigneeId: userA.id },
    });

    // B non è coinvolto e non ha lo scope amministrativo: porta chiusa.
    const prima = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(prima.statusCode).toBe(403);

    // A lo chiama in causa nella chat: la menzione VERA, con la sua notifica.
    const commento = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: await cookie("a@authz.local") },
      payload: { body: "@Utente B puoi dare un occhio?" },
    });
    expect(commento.statusCode).toBe(201);

    // Ora B legge il task, in sola lettura dichiarata…
    const dopo = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(dopo.statusCode).toBe(200);
    expect(dopo.json().canEdit).toBe(false);
    expect(dopo.json().canDelete).toBe(false);

    // …legge la conversazione…
    const messaggi = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(messaggi.statusCode).toBe(200);
    expect(messaggi.json().items[0].body).toContain("dare un occhio");

    // …e risponde.
    const risposta = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: await cookie("b@authz.local") },
      payload: { body: "Visto, ci penso io a spiegarlo" },
    });
    expect(risposta.statusCode).toBe(201);

    // La modifica resta chiusa: la menzione non la concede mai.
    const modifica = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("b@authz.local") },
      payload: { title: "Riscritto da B" },
    });
    expect(modifica.statusCode).toBe(403);
    const cancella = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(cancella.statusCode).toBe(403);
  });

  it("la menzione non allarga gli elenchi: il task resta fuori dalla ricerca del perimetro", async () => {
    // La regola vale sull'apertura diretta; le bacheche e la ricerca non cambiano.
    const { visibleTaskWhere } = await import("../src/modules/visibility/task-perimeter");
    const b = await prisma.user.findUniqueOrThrow({ where: { email: "b@authz.local" } });
    const where = await visibleTaskWhere(b);
    const visibili = await prisma.task.findMany({
      where: where ?? undefined,
      select: { title: true },
    });
    expect(visibili.map((t) => t.title)).not.toContain("Riservato ad A");
  });
});

describe("eliminazione task", () => {
  it("solo il creatore (o admin) elimina; un altro membro no", async () => {
    const task = await prisma.task.create({
      data: { title: "Da eliminare", statusId, creatorId: userA.id },
    });
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: await cookie("a@authz.local") },
    });
    expect(ok.statusCode).toBe(204);
  });
});

describe("gestione ricorrenze", () => {
  it("solo owner o admin modificano/eliminano la ricorrenza", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/recurrence-templates",
      headers: { cookie: await cookie("a@authz.local") },
      payload: { title: "Canone", dtstart: "2026-08-01", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    // B (non owner, non admin) non può modificare né eliminare.
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/recurrence-templates/${id}`,
          headers: { cookie: await cookie("b@authz.local") },
          payload: { title: "Rubata" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/recurrence-templates/${id}`,
          headers: { cookie: await cookie("b@authz.local") },
        })
      ).statusCode,
    ).toBe(403);

    // L'owner sì.
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/recurrence-templates/${id}`,
          headers: { cookie: await cookie("a@authz.local") },
          payload: { title: "Canone aggiornato" },
        })
      ).statusCode,
    ).toBe(200);

    // E anche un amministratore.
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/recurrence-templates/${id}`,
          headers: { cookie: await cookie("admin@authz.local") },
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe("anagrafica clienti", () => {
  it("chi non lavora il CRM non rinomina, non elimina e non annota un'azienda", async () => {
    // Difetto trovato il 06/08/2026: PATCH e DELETE chiedevano il solo login.
    // Un utente interno qualunque poteva rinominare o cestinare l'azienda di un
    // collega — anche una che non aveva il permesso di vedere.
    const company = await prisma.company.create({ data: { name: "Acme Authz" } });
    const b = await cookie("b@authz.local");

    const rename = await app.inject({
      method: "PATCH",
      url: `/api/companies/${company.id}`,
      headers: { cookie: b },
      payload: { name: "Rinominata di nascosto" },
    });
    expect(rename.statusCode).toBe(403);

    const note = await app.inject({
      method: "POST",
      url: `/api/companies/${company.id}/notes`,
      headers: { cookie: b },
      payload: { body: "nota non autorizzata" },
    });
    expect(note.statusCode).toBe(403);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/companies/${company.id}`,
      headers: { cookie: b },
    });
    expect(remove.statusCode).toBe(403);

    // Il nome è rimasto quello, e l'azienda non è nel cestino.
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.name).toBe("Acme Authz");
    expect(after.deletedAt).toBeNull();

    // L'admin lavora il CRM: fa tutto.
    const byAdmin = await app.inject({
      method: "PATCH",
      url: `/api/companies/${company.id}`,
      headers: { cookie: await cookie("admin@authz.local") },
      payload: { name: "Acme rinominata" },
    });
    expect(byAdmin.statusCode).toBe(200);
  });

  it("il conteggio dei progetti sotto un cliente mostra solo quelli che si vedono", async () => {
    // Un numero che porta a un elenco più corto è un numero che non torna: il
    // contatore usa la stessa regola della pagina Progetti.
    const company = await prisma.company.create({ data: { name: "Cliente con due progetti" } });
    const b = await prisma.user.findUniqueOrThrow({ where: { email: "b@authz.local" } });
    const suo = await prisma.project.create({
      data: { name: "Progetto di B", companyId: company.id },
    });
    await prisma.projectMember.create({
      data: { projectId: suo.id, userId: b.id, role: "EDITOR" },
    });
    await prisma.project.create({ data: { name: "Progetto di altri", companyId: company.id } });

    const perB = await app.inject({
      method: "GET",
      url: `/api/companies/${company.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(perB.json().projectCount).toBe(1);

    const perAdmin = await app.inject({
      method: "GET",
      url: `/api/companies/${company.id}`,
      headers: { cookie: await cookie("admin@authz.local") },
    });
    expect(perAdmin.json().projectCount).toBe(2);
  });

  it("creare resta aperto: serve a collegare un cliente a un progetto", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { cookie: await cookie("b@authz.local") },
      payload: { name: "Cliente di un progetto" },
    });
    expect(created.statusCode).toBe(201);
  });

  it("le note del CRM non si leggono da chi vede l'azienda solo per un progetto", async () => {
    const company = await prisma.company.create({ data: { name: "Cliente con note" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@authz.local" } });
    await prisma.crmNote.create({
      data: { companyId: company.id, authorId: admin.id, body: "trattativa delicata" },
    });
    // B vede l'azienda solo perché è il cliente di un progetto di cui è membro.
    const project = await prisma.project.create({
      data: { name: "Progetto del cliente", companyId: company.id },
    });
    const b = await prisma.user.findUniqueOrThrow({ where: { email: "b@authz.local" } });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: b.id, role: "EDITOR" },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/companies/${company.id}`,
      headers: { cookie: await cookie("b@authz.local") },
    });
    expect(detail.statusCode).toBe(200); // l'azienda la vede…
    expect(detail.json().crmNotes).toEqual([]); // …ma non le note del CRM

    const perAdmin = await app.inject({
      method: "GET",
      url: `/api/companies/${company.id}`,
      headers: { cookie: await cookie("admin@authz.local") },
    });
    expect(perAdmin.json().crmNotes).toHaveLength(1);
  });
});
