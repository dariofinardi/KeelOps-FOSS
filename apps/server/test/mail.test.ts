// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { NotificationType, TaskKind, UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("mail");
// Configurata = accesa: basta dire dove consegnare.
process.env.MAILER_HOST = "smtp.example";
process.env.APP_BASE_URL = "https://keelops.example";

const { prisma } = await import("../src/db");
const { notify, sendDeferredEmails } = await import("../src/modules/notifications/service");
const { flushMail, setMailTransport } = await import("../src/modules/mail/service");
const { memoryTransport } = await import("../src/modules/mail/transports");
const { notificationUrl } = await import("../src/modules/mail/notification-mail");
const { puoRicevereEmail } = await import("../src/modules/mail/service");
const { buildApp } = await import("../src/app");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");

const posta = memoryTransport();
let destinatarioId = "";
let attoreId = "";
let app: Awaited<ReturnType<typeof buildApp>>;
let adminCookie = "";
let destinatarioCookie = "";

async function loginCookie(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return `${SESSION_COOKIE}=${response.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

beforeAll(async () => {
  setMailTransport(posta);
  const hash = await hashPassword("prova-1234");
  const destinatario = await prisma.user.create({
    data: {
      email: "vera@x.local",
      name: "Vera Verdi",
      role: UserRole.MEMBER,
      emailWeekend: true,
      passwordHash: hash,
    },
  });
  const attore = await prisma.user.create({
    data: { email: "aldo@x.local", name: "Aldo Attore", role: UserRole.MEMBER, emailWeekend: true },
  });
  await prisma.user.create({
    data: {
      email: "admin@mail.test",
      name: "Amministratore",
      role: UserRole.ADMIN,
      adminUntil: new Date("2099-01-01"), // fixture: admin elevato (vedi auth/elevation)
      passwordHash: hash,
    },
  });
  destinatarioId = destinatario.id;
  attoreId = attore.id;
  // Questi test leggono i messaggi in italiano (scritti prima del multilingua).
  // Gli utenti appena creati nascono con locale "auto" (default di prodotto →
  // inglese): si dichiara la lingua, come fa il setup web con changeLanguage("it").
  await prisma.user.updateMany({ data: { locale: "it" } });
  app = await buildApp();
  adminCookie = await loginCookie("admin@mail.test", "prova-1234");
  destinatarioCookie = await loginCookie("vera@x.local", "prova-1234");
});

afterAll(async () => {
  setMailTransport(null);
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("configurazione delle email", () => {
  it("le impostazioni del template si salvano e tornano nell'anteprima", async () => {
    const salva = await app.inject({
      method: "PUT",
      url: "/api/admin/mail",
      headers: { cookie: adminCookie },
      payload: { intro: "Aggiornamento dal gestionale", footer: "Team di prova" },
    });
    expect(salva.statusCode).toBe(200);

    const config = await app.inject({
      method: "GET",
      url: "/api/admin/mail",
      headers: { cookie: adminCookie },
    });
    expect(config.json().settings.intro).toBe("Aggiornamento dal gestionale");
    // L'anteprima è il template vero, con dentro le impostazioni appena messe.
    expect(config.json().previewHtml).toContain("Aggiornamento dal gestionale");
    expect(config.json().previewHtml).toContain("Team di prova");
    // Lo stato dice se e dove si spedisce, MAI la password.
    expect(config.json().status.enabled).toBe(true);
    expect(JSON.stringify(config.json().status)).not.toContain("password");
  });

  it("l'invio di prova spedisce a chi lo chiede, e riferisce i guasti", async () => {
    posta.sent.length = 0;
    const prova = await app.inject({
      method: "POST",
      url: "/api/admin/mail/test",
      headers: { cookie: adminCookie },
    });
    expect(prova.statusCode).toBe(200);
    expect(posta.sent).toHaveLength(1);
    expect(posta.sent[0]!.to).toBe("admin@mail.test");
    expect(posta.sent[0]!.html).toContain("Messaggio di prova");
  });

  it("il logo dell'email si scarica senza sessione: nella posta i cookie non ci sono", async () => {
    // Difetto trovato il 06/08/2026: la rotta chiedeva l'autenticazione, quindi
    // il client di posta del destinatario riceveva un 401 e il logo non
    // compariva mai — né nell'email né nell'anteprima (iframe isolato).
    await prisma.appSetting.upsert({
      where: { key: "branding.logo" },
      update: { value: "logo-prova.webp" },
      create: { key: "branding.logo", value: "logo-prova.webp" },
    });
    const senzaCookie = await app.inject({ method: "GET", url: "/api/branding/logo" });
    // 404 perché il file non c'è davvero in questo test; ciò che conta è che
    // NON sia 401: la richiesta arriva fino alla ricerca del file.
    expect(senzaCookie.statusCode).not.toBe(401);
    expect(senzaCookie.statusCode).toBe(404);
  });

  it("la configurazione è riservata all'amministratore", async () => {
    const negato = await app.inject({
      method: "GET",
      url: "/api/admin/mail",
      headers: { cookie: destinatarioCookie },
    });
    expect(negato.statusCode).toBe(403);
  });
});

describe("connettore email delle notifiche", () => {
  it("una notifica diventa anche un messaggio, con il link al record", async () => {
    posta.sent.length = 0;
    await notify(destinatarioId, attoreId, NotificationType.TASK_ASSIGNED, {
      message: () => 'Aldo Attore ti ha assegnato il task "Fattura Acme"',
      taskId: "task-1",
      taskKind: TaskKind.ADMIN,
    });
    // L'email parte dopo l'attesa, se nessuno ha letto l'avviso (email-queue.ts).
    await sendDeferredEmails(new Date(Date.now() + 16 * 60_000));
    await flushMail();
    expect(posta.sent).toHaveLength(1);
    const messaggio = posta.sent[0]!;
    expect(messaggio.to).toBe("vera@x.local");
    expect(messaggio.subject).toContain("KeelOps");
    expect(messaggio.text).toContain("Ciao Vera Verdi");
    expect(messaggio.text).toContain('ti ha assegnato il task "Fattura Acme"');
    expect(messaggio.text).toContain("https://keelops.example/bacheche?task=task-1");
  });

  it("il link segue il tipo di record, come il click sulla campanella", () => {
    const base = "https://keelops.example";
    expect(
      notificationUrl(base, { type: "x", text: "", taskId: "d1", taskKind: TaskKind.DEAL }),
    ).toBe("https://keelops.example/offerte?deal=d1");
    expect(
      notificationUrl(base, { type: "x", text: "", taskId: "t1", taskKind: TaskKind.PROJECT }),
    ).toBe("https://keelops.example/bacheche?task=t1");
    // Riepilogo scadenze: parla di più task, porta all'agenda.
    expect(notificationUrl(base, { type: NotificationType.DUE_DIGEST, text: "" })).toBe(
      "https://keelops.example/bacheche",
    );
    // Barra finale di troppo nella configurazione: non deve raddoppiarsi.
    expect(notificationUrl("https://keelops.example/", { type: "x", text: "" })).toBe(
      "https://keelops.example",
    );
  });

  /**
   * **Un cliente del portale non ha le nostre pagine.** La sua richiesta nasce
   * come task di progetto, e il link finiva su `/bacheche` — che nel portale non
   * esiste: atterrava su una lista muta, e da lì l'email sembrava rotta
   * (02/09/2026).
   */
  it("al cliente del portale il link porta a casa sua, non su /bacheche", () => {
    const base = "https://keelops.example";
    const avviso = { type: "ticket_update", text: "", taskId: "t1", taskKind: TaskKind.PROJECT };
    expect(notificationUrl(base, avviso, true)).toBe("https://keelops.example");
    // e per un interno resta il link al record, come prima
    expect(notificationUrl(base, avviso, false)).toBe("https://keelops.example/bacheche?task=t1");
  });

  it("chi ha spento tutti e due i canali per quel tipo non riceve niente", async () => {
    posta.sent.length = 0;
    await prisma.notificationPreference.create({
      data: {
        userId: destinatarioId,
        type: NotificationType.TASK_COMMENT,
        enabled: false,
        email: false,
      },
    });
    await notify(destinatarioId, attoreId, NotificationType.TASK_COMMENT, {
      message: () => "Aldo ha commentato",
      taskId: "task-2",
      taskKind: TaskKind.ADMIN,
    });
    await flushMail();
    expect(posta.sent).toHaveLength(0);
    expect(
      await prisma.notification.count({
        where: { userId: destinatarioId, type: NotificationType.TASK_COMMENT },
      }),
    ).toBe(0);
  });

  it("a un utente disattivato non si scrive", async () => {
    posta.sent.length = 0;
    const uscito = await prisma.user.create({
      data: {
        email: "uscito@x.local",
        name: "Ugo Uscito",
        role: UserRole.MEMBER,
        emailWeekend: true,
        isActive: false,
      },
    });
    await notify(uscito.id, attoreId, NotificationType.TASK_ASSIGNED, {
      message: () => "Assegnato",
      taskId: "task-3",
      taskKind: TaskKind.ADMIN,
    });
    await flushMail();
    // La notifica in-app resta (la si troverà rientrando), l'email no.
    expect(await prisma.notification.count({ where: { userId: uscito.id } })).toBe(1);
    expect(posta.sent).toHaveLength(0);
  });

  it("se la posta è guasta la notifica in-app resta comunque", async () => {
    // È la proprietà che conta: il canale su cui l'applicazione fa affidamento
    // è la campanella, e un server SMTP irraggiungibile non deve toglierla.
    setMailTransport({
      name: "guasto",
      send: () => Promise.reject(new Error("connessione rifiutata")),
    });
    await expect(
      notify(destinatarioId, attoreId, NotificationType.MENTION, {
        message: () => "Menzione con posta guasta",
        taskId: "task-4",
        taskKind: TaskKind.ADMIN,
      }),
    ).resolves.toBe(true);
    await flushMail();
    expect(
      await prisma.notification.count({
        where: { userId: destinatarioId, type: NotificationType.MENTION },
      }),
    ).toBe(1);
    setMailTransport(posta);
  });
});

/**
 * **Il ruolo non decide chi riceve un'email.** Un cliente del portale
 * nell'applicazione non ci vive dentro: la posta è l'unico modo di
 * raggiungerlo, e un filtro di troppo qui lo taglierebbe fuori da tutto senza
 * dare errore da nessuna parte (02/09/2026).
 */
describe("chi può ricevere un'email", () => {
  const tizio = { email: "tizio@example.com", isActive: true, isSystem: false };

  it("un cliente del portale come chiunque altro: il ruolo non entra nella domanda", () => {
    expect(puoRicevereEmail(tizio)).toBe(true);
  });

  it("ma non chi è disattivato, non l'utente di sistema, non un indirizzo che non è tale", () => {
    expect(puoRicevereEmail({ ...tizio, isActive: false })).toBe(false);
    expect(puoRicevereEmail({ ...tizio, isSystem: true })).toBe(false);
    expect(puoRicevereEmail({ ...tizio, email: "Archivio" })).toBe(false);
  });
});
