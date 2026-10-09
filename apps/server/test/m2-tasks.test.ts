import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("m2");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let adminCookie: string;
let openStatusId: string;
let closedStatusId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return `${SESSION_COOKIE}=${cookie!.value}`;
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      email: "admin@test.local",
      name: "Admin",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: await hashPassword("admin1234"),
    },
  });
  // Gli stati arrivano dalle migrazioni, distinti per categoria: i task dello
  // scadenzario senza tipo di attività usano quelli amministrativi.
  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: true },
    orderBy: { order: "asc" },
  });
  openStatusId = open.id;
  closedStatusId = closed.id;
  app = await buildApp();
  adminCookie = await loginCookie("admin@test.local", "admin1234");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

async function createTask(payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: { cookie: adminCookie },
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe("activity types", () => {
  it("assigns and filters tasks by activity type", async () => {
    const type = await prisma.activityType.create({
      data: { name: "Emissione fattura", category: "ADMIN", color: "#f59e0b", order: 0 },
    });

    // GET elenco tipi.
    const list = await app.inject({
      method: "GET",
      url: "/api/activity-types",
      headers: { cookie: adminCookie },
    });
    expect(list.json().some((t: { id: string }) => t.id === type.id)).toBe(true);

    // Creazione con tipo → DTO lo espone.
    const created = await createTask({ title: "Fattura ACME", activityTypeId: type.id });
    expect(created.activityType).toMatchObject({ id: type.id, name: "Emissione fattura" });
    await createTask({ title: "Task senza tipo" });

    // Filtro per tipo.
    const filtered = await app.inject({
      method: "GET",
      url: `/api/tasks?activityTypeId=${type.id}`,
      headers: { cookie: adminCookie },
    });
    const titles = filtered.json().items.map((t: { title: string }) => t.title);
    expect(titles).toContain("Fattura ACME");
    expect(titles).not.toContain("Task senza tipo");

    // Tipo inesistente → 400.
    const bad = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
      payload: { title: "X", activityTypeId: "inesistente" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("task statuses", () => {
  it("requires auth to list", async () => {
    const response = await app.inject({ method: "GET", url: "/api/task-statuses" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, reorders and protects used statuses", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/task-statuses",
      headers: { cookie: adminCookie },
      payload: { name: "In lavorazione", category: "GENERAL", color: "#f59e0b" },
    });
    expect(created.statusCode).toBe(201);
    const newId = created.json().id;

    // Il riordino vale dentro la categoria: servono tutti i suoi stati.
    const generalIds = (
      await prisma.taskStatus.findMany({
        where: { category: "GENERAL" },
        orderBy: { order: "asc" },
      })
    ).map((status) => status.id);
    const reorder = await app.inject({
      method: "PUT",
      url: "/api/task-statuses/reorder",
      headers: { cookie: adminCookie },
      payload: { ids: [newId, ...generalIds.filter((id) => id !== newId)] },
    });
    expect(reorder.statusCode).toBe(200);
    expect(reorder.json().find((s: { category: string }) => s.category === "GENERAL").id).toBe(
      newId,
    );

    // Ripristina l'ordine e rimuovi lo stato extra.
    await app.inject({
      method: "PUT",
      url: "/api/task-statuses/reorder",
      headers: { cookie: adminCookie },
      payload: { ids: [...generalIds.filter((id) => id !== newId), newId] },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/task-statuses/${newId}`,
      headers: { cookie: adminCookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("refuses to delete a status in use", async () => {
    await createTask({ title: "Task che usa lo stato", statusId: openStatusId });
    const response = await app.inject({
      method: "DELETE",
      url: `/api/task-statuses/${openStatusId}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("tasks", () => {
  it("creates with default status and logs 'created'", async () => {
    const task = await createTask({ title: "Pagare fornitore", dueDate: "2026-08-15" });
    expect(task.status.id).toBe(openStatusId);
    expect(task.dueDate).toBe("2026-08-15");
    // Le attività si caricano dall'endpoint lazy dedicato (non più nel dettaglio).
    const activities = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/activities`,
      headers: { cookie: adminCookie },
    });
    expect(activities.json().items.map((a: { action: string }) => a.action)).toContain("created");
  });

  it("il referente di default è chi crea, ma si può togliere di proposito", async () => {
    // Chi apre un task ne risponde: i "veloci" (da un'offerta, da un progetto)
    // non mandano il campo e nascevano senza nessuno che li seguisse.
    const veloce = await createTask({ title: "Aggiunto al volo" });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    expect(veloce.supervisor?.id).toBe(admin.id);

    // Campo svuotato a mano ≠ campo assente: la scelta esplicita vince.
    const senzaReferente = await createTask({ title: "Senza referente", supervisorId: null });
    expect(senzaReferente.supervisor).toBeNull();
  });

  it("changing status logs it and sets closedAt on closed statuses", async () => {
    const task = await createTask({ title: "Da chiudere" });
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().closedAt).not.toBeNull();
    const activities = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/activities`,
      headers: { cookie: adminCookie },
    });
    const actions = activities.json().items.map((a: { action: string }) => a.action);
    expect(actions).toContain("status_changed");

    const reopened = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: openStatusId },
    });
    expect(reopened.json().closedAt).toBeNull();
  });

  it("filters by text and excludes closed by default", async () => {
    await createTask({ title: "Fattura speciale XYZ" });
    const closedTask = await createTask({ title: "Chiusa ABC", statusId: closedStatusId });

    const byText = await app.inject({
      method: "GET",
      url: "/api/tasks?q=XYZ",
      headers: { cookie: adminCookie },
    });
    expect(byText.json().items).toHaveLength(1);
    expect(byText.json().total).toBe(1);
    expect(byText.json().items[0].title).toBe("Fattura speciale XYZ");

    const defaultList = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: adminCookie },
    });
    expect(defaultList.json().items.some((t: { id: string }) => t.id === closedTask.id)).toBe(
      false,
    );

    const withClosed = await app.inject({
      method: "GET",
      url: "/api/tasks?includeClosed=true",
      headers: { cookie: adminCookie },
    });
    expect(withClosed.json().items.some((t: { id: string }) => t.id === closedTask.id)).toBe(true);
  });

  it("adds comments with activity log", async () => {
    const task = await createTask({ title: "Con commenti" });
    const comment = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: adminCookie },
      payload: { body: "Primo commento @Admin" },
    });
    expect(comment.statusCode).toBe(201);

    const comments = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/comments`,
      headers: { cookie: adminCookie },
    });
    expect(comments.json().items).toHaveLength(1);
    const activities = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/activities`,
      headers: { cookie: adminCookie },
    });
    expect(activities.json().items.map((a: { action: string }) => a.action)).toContain("commented");
  });

  it("paginates comments lazily by cursor, newest first", async () => {
    const task = await createTask({ title: "Molti commenti" });
    for (const n of [1, 2, 3]) {
      await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/comments`,
        headers: { cookie: adminCookie },
        payload: { body: `commento ${n}` },
      });
    }

    // Prima pagina (limit=2): le due più recenti, con cursore per proseguire.
    const first = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/comments?limit=2`,
      headers: { cookie: adminCookie },
    });
    expect(first.json().items.map((c: { body: string }) => c.body)).toEqual([
      "commento 3",
      "commento 2",
    ]);
    expect(first.json().nextCursor).not.toBeNull();

    // Seconda pagina: la più vecchia, poi il cursore si esaurisce.
    const second = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/comments?limit=2&cursor=${first.json().nextCursor}`,
      headers: { cookie: adminCookie },
    });
    expect(second.json().items.map((c: { body: string }) => c.body)).toEqual(["commento 1"]);
    expect(second.json().nextCursor).toBeNull();
  });
});

describe("task sequences", () => {
  it("chains tasks and warns (409) when completing out of order", async () => {
    const first = await createTask({ title: "Sequenza: passo 1" });
    const second = await createTask({ title: "Sequenza: passo 2", predecessorId: first.id });
    const third = await createTask({ title: "Sequenza: passo 3", predecessorId: second.id });

    // Completare il passo 3 con 1 e 2 aperti → richiede conferma.
    const blocked = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${third.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("SEQUENCE_INCOMPLETE");
    expect(blocked.json().message).toContain("passo 1");
    expect(blocked.json().message).toContain("passo 2");

    // Con conferma esplicita si procede comunque (non bloccante).
    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${third.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId, confirmSequence: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().closedAt).not.toBeNull();

    // Completati i propedeutici, nessun avviso.
    await app.inject({
      method: "PATCH",
      url: `/api/tasks/${first.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    const secondDone = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${second.id}`,
      headers: { cookie: adminCookie },
      payload: { statusId: closedStatusId },
    });
    expect(secondDone.statusCode).toBe(200);
  });

  // Scegliere il "task successivo" dal dettaglio = scrivere questo task come
  // predecessore dell'altro. Queste sono le garanzie su cui si appoggia quella UI.
  it("collega un successivo a posteriori, rifiuta il ciclo e permette di staccarlo", async () => {
    const current = await createTask({ title: "Successivi: corrente" });
    const next = await createTask({ title: "Successivi: prossimo" });

    const linked = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${next.id}`,
      headers: { cookie: adminCookie },
      payload: { predecessorId: current.id },
    });
    expect(linked.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${current.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().successors.map((s: { id: string }) => s.id)).toContain(next.id);

    // Chiudere l'anello (il corrente dopo il suo successivo) deve essere rifiutato.
    const cycle = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${current.id}`,
      headers: { cookie: adminCookie },
      payload: { predecessorId: next.id },
    });
    expect(cycle.statusCode).toBe(400);

    // Distacco: predecessorId a null e il successivo sparisce dalla sequenza.
    const unlinked = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${next.id}`,
      headers: { cookie: adminCookie },
      payload: { predecessorId: null },
    });
    expect(unlinked.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: `/api/tasks/${current.id}`,
      headers: { cookie: adminCookie },
    });
    expect(after.json().successors).toHaveLength(0);
  });

  it("exposes predecessor and successors in the detail", async () => {
    const first = await createTask({ title: "Capo catena" });
    const second = await createTask({ title: "Anello due", predecessorId: first.id });

    const firstDetail = await app.inject({
      method: "GET",
      url: `/api/tasks/${first.id}`,
      headers: { cookie: adminCookie },
    });
    expect(firstDetail.json().successors.map((s: { id: string }) => s.id)).toContain(second.id);

    const secondDetail = await app.inject({
      method: "GET",
      url: `/api/tasks/${second.id}`,
      headers: { cookie: adminCookie },
    });
    expect(secondDetail.json().predecessor.id).toBe(first.id);
  });

  it("rejects cycles in the chain", async () => {
    const a = await createTask({ title: "Ciclo A" });
    const b = await createTask({ title: "Ciclo B", predecessorId: a.id });

    const selfRef = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${a.id}`,
      headers: { cookie: adminCookie },
      payload: { predecessorId: a.id },
    });
    expect(selfRef.statusCode).toBe(400);

    const cycle = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${a.id}`,
      headers: { cookie: adminCookie },
      payload: { predecessorId: b.id },
    });
    expect(cycle.statusCode).toBe(400);
  });
});

describe("attachments", () => {
  it("adds and removes a link attachment", async () => {
    const task = await createTask({ title: "Con link" });
    const link = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/attachments/link`,
      headers: { cookie: adminCookie },
      payload: { name: "Documento Drive", url: "https://docs.google.com/document/d/abc" },
    });
    expect(link.statusCode).toBe(201);
    expect(link.json().type).toBe("LINK");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${task.id}/attachments/${link.json().id}`,
      headers: { cookie: adminCookie },
    });
    expect(removed.statusCode).toBe(204);

    const detail = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json().attachments).toHaveLength(0);
  });

  it("uploads a file and downloads it back", async () => {
    const task = await createTask({ title: "Con file" });
    const boundary = "----kancrmtestboundary";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="nota spese.txt"`,
      "Content-Type: text/plain",
      "",
      "contenuto del file di prova",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploaded = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/attachments/file`,
      headers: {
        cookie: adminCookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().type).toBe("FILE");
    expect(uploaded.json().size).toBeGreaterThan(0);

    // Download non diretto: prima il token (autorizzato), poi lo streaming.
    const tokenRes = await app.inject({
      method: "GET",
      url: `/api/attachments/${uploaded.json().id}/download-token`,
      headers: { cookie: adminCookie },
    });
    expect(tokenRes.statusCode).toBe(200);
    const download = await app.inject({ method: "GET", url: tokenRes.json().url });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe("contenuto del file di prova");
  });

  it("chi vuole leggere un documento lo ottiene a schermo, non da scaricare", async () => {
    const task = await createTask({ title: "Con documento" });
    const carica = async (filename: string, contentType: string) => {
      const boundary = "----kancrmtestboundary";
      const body = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        `Content-Type: ${contentType}`,
        "",
        "contenuto",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const uploaded = await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/attachments/file`,
        headers: {
          cookie: adminCookie,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(uploaded.statusCode).toBe(201);
      return uploaded.json().id as string;
    };
    const apri = async (id: string, intent?: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/attachments/${id}/open${intent ? `?intent=${intent}` : ""}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { mode: string; url: string };
    };

    const pdf = await carica("contratto.pdf", "application/pdf");
    // Senza chiedere nulla si scarica come sempre; chiedendo di leggerlo arriva
    // l'indirizzo del lettore, che serve il file inline.
    expect((await apri(pdf)).mode).toBe("download");
    const lettura = await apri(pdf, "view");
    expect(lettura.mode).toBe("viewer");
    const inline = await app.inject({ method: "GET", url: lettura.url });
    expect(inline.statusCode).toBe(200);
    expect(inline.headers["content-disposition"]).toBe("inline");

    // Quello che il lettore non sa disegnare torna al download: niente riquadro vuoto.
    const zip = await carica("archivio.zip", "application/zip");
    expect((await apri(zip, "view")).mode).toBe("download");
  });
});

describe("filtro per area di lavoro (tendina delle bacheche)", () => {
  it("l'area commerciale mostra i suoi; l'amministrativa tiene Generali e senza tipo", async () => {
    const sales = await prisma.activityType.create({
      data: { name: "Telefonata area-test", category: "SALES", color: "#111111", order: 90 },
    });
    const general = await prisma.activityType.create({
      data: { name: "Riunione area-test", category: "GENERAL", color: "#222222", order: 91 },
    });
    const commerciale = await createTask({
      title: "Chiamata al cliente",
      activityTypeId: sales.id,
    });
    const trasversale = await createTask({
      title: "Riunione di reparto",
      activityTypeId: general.id,
    });
    const senzaTipo = await createTask({ title: "Adempimento nudo" });

    const list = async (category: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks?category=${category}`,
        headers: { cookie: adminCookie },
      });
      expect(response.statusCode).toBe(200);
      return response.json().items.map((task: { id: string }) => task.id);
    };

    const salesIds = await list("SALES");
    expect(salesIds).toContain(commerciale.id);
    expect(salesIds).not.toContain(trasversale.id);
    expect(salesIds).not.toContain(senzaTipo.id);

    // Il modulo è lo scadenzario: Generali e senza-tipo ricadono qui, come
    // nella bacheca (statusCategoryOf).
    const adminIds = await list("ADMIN");
    expect(adminIds).toContain(trasversale.id);
    expect(adminIds).toContain(senzaTipo.id);
    expect(adminIds).not.toContain(commerciale.id);
  });

  it("i numeri delle tendine dicono cosa vedresti: ogni facet applica gli ALTRI filtri", async () => {
    // Il caso segnalato: "Dario Ferri (41)" accanto a una tabella di 4 righe.
    // Ora scegliendo un'area il conteggio per assegnatario si restringe a quella.
    const sales = await prisma.activityType.findFirstOrThrow({ where: { name: "Telefonata area-test" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    await createTask({ title: "Commerciale mio", activityTypeId: sales.id, assigneeId: admin.id });
    await createTask({ title: "Amministrativo mio", assigneeId: admin.id });

    const facets = async (query: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks${query}`,
        headers: { cookie: adminCookie },
      });
      return response.json().facets;
    };

    const senzaArea = await facets("");
    const conArea = await facets("?category=SALES");
    const mio = (f: { assignees: Array<{ id: string; count: number }> }) =>
      f.assignees.find((a) => a.id === admin.id)?.count ?? 0;
    // Senza filtro area conta tutto il mio; con l'area commerciale, solo quelli.
    expect(mio(senzaArea)).toBeGreaterThan(mio(conArea));
    expect(mio(conArea)).toBe(1);

    // E l'elenco è coerente col numero: quello che dice la tendina è ciò che esce.
    const lista = await app.inject({
      method: "GET",
      url: `/api/tasks?category=SALES&assigneeId=${admin.id}`,
      headers: { cookie: adminCookie },
    });
    expect(lista.json().items).toHaveLength(1);

    // Una scelta che in quel contesto non ha task resta comunque in tendina
    // (con zero): sparendo, l'autoguarigione la cancellerebbe di nascosto.
    const altro = await prisma.user.create({
      data: { email: "senzatask@test.local", name: "Senza Task", role: UserRole.MEMBER },
    });
    const conScelta = await facets(`?category=SALES&assigneeId=${altro.id}`);
    const voce = conScelta.assignees.find((a: { id: string }) => a.id === altro.id);
    expect(voce).toBeDefined();
    expect(voce.count).toBe(0);
  });

  it("le aree offerte sono solo quelle che hanno task, e non si azzerano scegliendone una", async () => {
    // Nello scadenzario i task tecnici non esistono (stanno nei progetti):
    // offrire l'area tecnica dava una lista vuota senza spiegazione.
    const areas = async (query = "") => {
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks${query}`,
        headers: { cookie: adminCookie },
      });
      return response.json().facets.areas as Array<{ category: string; count: number }>;
    };

    const tutte = await areas();
    expect(tutte.map((a) => a.category)).toContain("ADMIN");
    expect(tutte.map((a) => a.category)).toContain("SALES");
    expect(tutte.map((a) => a.category)).not.toContain("DEV");
    expect(tutte.every((a) => a.count > 0)).toBe(true);

    // Scegliendo un'area, l'elenco delle aree resta lo stesso: la facet dice
    // cosa c'è, non cosa si è scelto (altrimenti non si potrebbe tornare).
    expect(await areas("?category=SALES")).toEqual(tutte);
  });
});
