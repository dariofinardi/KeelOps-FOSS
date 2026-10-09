import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("calpush");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let userCookie: string;
let userId: string;

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  const everyone = await prisma.group.create({ data: { name: "Tutti" } });
  await prisma.visibilitySetting.create({
    data: { scope: "ADMIN_TASKS", groupId: everyone.id },
  });
  const user = await prisma.user.create({
    data: {
      email: "user@test.local",
      name: "Ugo Utente",
      role: UserRole.MEMBER,
      passwordHash: await hashPassword("user12345"),
      groups: { create: { groupId: everyone.id } },
    },
  });
  userId = user.id;
  // Stato aperto della categoria amministrativa (creato dalle migrazioni).
  const status = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: false },
    orderBy: { order: "asc" },
  });
  const closed = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "ADMIN", isClosed: true },
    orderBy: { order: "asc" },
  });

  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Scadenza; con caratteri, speciali",
      statusId: status.id,
      creatorId: user.id,
      assigneeId: user.id,
      dueDate: new Date("2026-10-15T00:00:00Z"),
    },
  });
  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Senza scadenza",
      statusId: status.id,
      creatorId: user.id,
      assigneeId: user.id,
    },
  });
  // Chiuso: non deve comparire nel feed.
  await prisma.task.create({
    data: {
      kind: "ADMIN",
      title: "Già fatto",
      statusId: closed.id,
      creatorId: user.id,
      assigneeId: user.id,
      dueDate: new Date("2026-10-01T00:00:00Z"),
    },
  });

  // I link del calendario sono assoluti per forza (li apre un altro programma,
  // spesso su un'altra rete): senza indirizzo pubblico non ci sarebbe niente da
  // copiare. È lo stesso valore della pagina Email.
  await prisma.appSetting.create({
    data: { key: "mail.baseUrl", value: "https://crm.esempio.it" },
  });
  // I calendari nascono spenti: è l'amministratore ad aprirli. Qui si accendono
  // per provarli; c'è un caso apposta sull'interruttore.
  await prisma.appSetting.create({ data: { key: "calendar.feedsEnabled", value: "true" } });

  app = await buildApp();
  userCookie = await loginCookie("user@test.local", "user12345");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("calendari sottoscrivibili", () => {
  let feedUrl = "";
  let feedId = "";
  let token = "";

  const leggi = (t: string) => app.inject({ method: "GET", url: `/api/calendar/${t}.ics` });

  it("si crea un calendario per bacheca e lo si legge senza cookie", async () => {
    // Google, Outlook e i telefoni non mandano cookie: il token nell'indirizzo
    // è l'unica autenticazione possibile.
    const created = await app.inject({
      method: "POST",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
      payload: { scope: "MINE" },
    });
    expect(created.statusCode).toBe(201);
    feedId = created.json().id;
    feedUrl = created.json().url as string;
    expect(feedUrl).toMatch(/^https:\/\/crm\.esempio\.it\/api\/calendar\/.+\.ics$/);
    token = feedUrl.slice(feedUrl.indexOf("/api/calendar/") + "/api/calendar/".length, -4);

    const feed = await leggi(token);
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["content-type"]).toContain("text/calendar");
    expect(feed.body).toContain("BEGIN:VCALENDAR");
  });

  it("porta i task con una data, non quelli senza", async () => {
    // I client di calendario i VTODO li ignorano: pubblicare i task senza
    // scadenza vorrebbe dire spedirli e sperare.
    const body = (await leggi(token)).body.replaceAll("\r\n ", "");
    expect(body).toContain("Scadenza\\; con caratteri\\, speciali");
    expect(body).not.toContain("Senza scadenza");
    expect(body).not.toContain("BEGIN:VTODO");
  });

  it("chiedere lo stesso calendario due volte non moltiplica i link", async () => {
    const again = await app.inject({
      method: "POST",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
      payload: { scope: "MINE" },
    });
    expect(again.json().id).toBe(feedId);
    const elenco = await app.inject({
      method: "GET",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
    });
    expect(elenco.json().feeds).toHaveLength(1);
  });

  it("un calendario di qualcun altro non si revoca", async () => {
    const altro = await prisma.user.create({
      data: {
        email: "altro@test.local",
        name: "Altro",
        role: UserRole.MEMBER,
        passwordHash: await hashPassword("altro12345"),
      },
    });
    const suoCookie = await loginCookie("altro@test.local", "altro12345");
    const negato = await app.inject({
      method: "DELETE",
      url: `/api/calendar/feeds/${feedId}`,
      headers: { cookie: suoCookie },
    });
    expect(negato.statusCode).toBe(404);
    await prisma.user.delete({ where: { id: altro.id } });
  });

  it("revocato, il calendario non esiste più", async () => {
    const revoca = await app.inject({
      method: "DELETE",
      url: `/api/calendar/feeds/${feedId}`,
      headers: { cookie: userCookie },
    });
    expect(revoca.statusCode).toBe(204);
    expect((await leggi(token)).statusCode).toBe(404);
  });
});

describe("segna come fatto, dal calendario", () => {
  let url = "";
  let taskId = "";

  beforeAll(async () => {
    const status = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: false },
      orderBy: { order: "asc" },
    });
    const task = await prisma.task.create({
      data: {
        kind: "ADMIN",
        title: "Da chiudere dal telefono",
        statusId: status.id,
        creatorId: userId,
        assigneeId: userId,
        dueDate: new Date("2026-10-20T00:00:00Z"),
      },
    });
    taskId = task.id;
    const created = await app.inject({
      method: "POST",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
      payload: { scope: "MINE" },
    });
    const feedUrl = created.json().url as string;
    const token = feedUrl.slice(feedUrl.indexOf("/api/calendar/") + "/api/calendar/".length, -4);
    const ics = (await app.inject({ method: "GET", url: `/api/calendar/${token}.ics` })).body;
    // Il link si legge dal feed, come farebbe una persona dal telefono — quello
    // di QUESTO task: nel calendario ce n'è uno per ogni scadenza.
    const riga = ics
      .replaceAll("\r\n ", "")
      .match(new RegExp(`Segna come fatto: (\\S*${taskId}\\S*)`));
    url = (riga?.[1] ?? "").replace("https://crm.esempio.it", "");
    expect(url).not.toBe("");
  });

  const stato = async () => {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { status: true },
    });
    return task.status!;
  };

  it("aprire il link non chiude niente: chiede conferma", async () => {
    // I programmi di posta e i motori di anteprima VISITANO i link che trovano:
    // un GET che chiude un task verrebbe premuto da un programma, non da una
    // persona.
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Segnare come fatto?");
    expect((await stato()).isClosed).toBe(false);
  });

  it("confermando, il task si chiude davvero", async () => {
    const res = await app.inject({ method: "POST", url });
    expect(res.body).toContain("è stato chiuso");
    expect((await stato()).isClosed).toBe(true);
  });

  it("una firma inventata non apre niente", async () => {
    const falso = url.replace(/c=[^&]+/, "c=firmadinventata");
    const res = await app.inject({ method: "POST", url: falso });
    expect(res.body).toContain("non funziona più");
  });

  it("revocato il calendario, il link smette di funzionare", async () => {
    // La firma contiene il token del feed: revocarlo spegne anche i link che
    // ne erano usciti, altrimenti continuerebbero a chiudere task per sempre.
    const feeds = await app.inject({
      method: "GET",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
    });
    for (const feed of (feeds.json() as { feeds: Array<{ id: string }> }).feeds) {
      await app.inject({
        method: "DELETE",
        url: `/api/calendar/feeds/${feed.id}`,
        headers: { cookie: userCookie },
      });
    }
    expect((await app.inject({ method: "GET", url })).body).toContain("non funziona più");
  });
});

describe("l'interruttore dei calendari", () => {
  const spegni = (value: boolean) =>
    prisma.appSetting.update({
      where: { key: "calendar.feedsEnabled" },
      data: { value: String(value) },
    });

  it("spenti, non si generano e i link già distribuiti non rispondono", async () => {
    // Un interruttore che lascia vive le porte già aperte non è un interruttore:
    // il feed è l'unico punto che si legge senza sessione.
    const created = await app.inject({
      method: "POST",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
      payload: { scope: "MINE" },
    });
    const feedUrl = created.json().url as string;
    const token = feedUrl.slice(feedUrl.indexOf("/api/calendar/") + "/api/calendar/".length, -4);
    expect(
      (await app.inject({ method: "GET", url: `/api/calendar/${token}.ics` })).statusCode,
    ).toBe(200);

    await spegni(false);
    expect(
      (await app.inject({ method: "GET", url: `/api/calendar/${token}.ics` })).statusCode,
    ).toBe(404);
    const negato = await app.inject({
      method: "POST",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
      payload: { scope: "SUPERVISED" },
    });
    expect(negato.statusCode).toBe(400);

    // E chi apre il Profilo lo sa, invece di copiare un indirizzo morto.
    const elenco = await app.inject({
      method: "GET",
      url: "/api/calendar/feeds",
      headers: { cookie: userCookie },
    });
    expect(elenco.json().enabled).toBe(false);
    await spegni(true);
  });
});

describe("chiedere agli amministratori", () => {
  const chiedi = () =>
    app.inject({
      method: "POST",
      url: "/api/calendar/feeds/request",
      headers: { cookie: userCookie },
    });
  const richieste = () =>
    prisma.task.findMany({
      where: { title: { startsWith: "Attivare i calendari esterni per" }, deletedAt: null },
      include: { status: true },
    });

  it("con i calendari accesi non c'è niente da chiedere", async () => {
    const res = await chiedi();
    expect(res.statusCode).toBe(400);
    expect(await richieste()).toHaveLength(0);
  });

  it("spenti, apre un task a ogni amministratore con scadenza a due giorni", async () => {
    await prisma.appSetting.update({
      where: { key: "calendar.feedsEnabled" },
      data: { value: "false" },
    });
    const primo = await prisma.user.create({
      data: { email: "admin1@test.local", name: "Prima Admin", role: UserRole.ADMIN },
    });
    const secondo = await prisma.user.create({
      data: { email: "admin2@test.local", name: "Secondo Admin", role: UserRole.ADMIN },
    });
    // Gli utenti disattivati non ricevono niente: nessuno leggerebbe quel task.
    await prisma.user.create({
      data: {
        email: "admin3@test.local",
        name: "Terzo Admin",
        role: UserRole.ADMIN,
        adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
        isActive: false,
      },
    });

    const res = await chiedi();
    expect(res.statusCode).toBe(200);
    expect(res.json().notified).toBe(2);

    const tasks = await richieste();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.assigneeId).sort()).toEqual([primo.id, secondo.id].sort());
    for (const task of tasks) {
      // Chi ha chiesto resta referente: è il modo per sapere com'è finita.
      expect(task.supervisorId).toBe(userId);
      expect(task.status?.isClosed).toBe(false);
      const giorni = Math.round((task.dueDate!.getTime() - Date.now()) / 86_400_000);
      expect(giorni).toBeLessThanOrEqual(2);
      expect(giorni).toBeGreaterThanOrEqual(1);
    }
  });

  it("ripremere non moltiplica i task", async () => {
    // Chi preme cinque volte perché non succede niente non deve generare
    // quindici task agli amministratori.
    const res = await chiedi();
    expect(res.json().notified).toBe(0);
    expect(await richieste()).toHaveLength(2);
  });

  it("chiusa la richiesta, se ne può fare un'altra", async () => {
    const chiuso = await prisma.taskStatus.findFirstOrThrow({
      where: { category: "ADMIN", isClosed: true },
      orderBy: { order: "asc" },
    });
    for (const task of await richieste()) {
      await prisma.task.update({ where: { id: task.id }, data: { statusId: chiuso.id } });
    }
    expect((await chiedi()).json().notified).toBe(2);
    await prisma.appSetting.update({
      where: { key: "calendar.feedsEnabled" },
      data: { value: "true" },
    });
  });
});

describe("web push", () => {
  it("exposes the VAPID public key and stores subscriptions per device", async () => {
    const key = await app.inject({
      method: "GET",
      url: "/api/push/public-key",
      headers: { cookie: userCookie },
    });
    expect(key.statusCode).toBe(200);
    expect(key.json().publicKey.length).toBeGreaterThan(40);
    // La chiave è persistita: una seconda richiesta restituisce la stessa.
    const again = await app.inject({
      method: "GET",
      url: "/api/push/public-key",
      headers: { cookie: userCookie },
    });
    expect(again.json().publicKey).toBe(key.json().publicKey);

    const subscribe = await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: { cookie: userCookie },
      payload: {
        endpoint: "https://push.example/device-1",
        keys: { p256dh: "chiave-p256dh", auth: "chiave-auth" },
      },
    });
    expect(subscribe.statusCode).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(1);

    // Idempotente sullo stesso endpoint.
    await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: { cookie: userCookie },
      payload: {
        endpoint: "https://push.example/device-1",
        keys: { p256dh: "nuova", auth: "nuova" },
      },
    });
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(1);

    const unsubscribe = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: { cookie: userCookie },
      payload: { endpoint: "https://push.example/device-1" },
    });
    expect(unsubscribe.statusCode).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(0);
  });
});
