// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { NotificationType, TaskKind, UserRole } from "@kancrm/shared";

/**
 * **Un'email sola al posto di quattordici.**
 *
 * Otto minuti di lavoro di un collega su cinque task hanno prodotto quattordici
 * email, quasi tutte sullo stesso pugno di record (misurato il 04/09/2026): a
 * quel punto la posta di KeelOps diventa qualcosa da archiviare in blocco. Chi
 * chiede di aggregarle non ne riceve nessuna sul momento — le raccoglie il
 * riepilogo — e in cambio la campanella resta immediata com'era.
 *
 * Le due cose che qui non devono succedere mai: che un avviso sparisca senza
 * essere mai stato spedito, e che ne parta uno due volte.
 */
const { tempDir } = prepareTestDb("email-digest");
process.env.MAILER_HOST = "smtp.example";
process.env.APP_BASE_URL = "https://keelops.example";

const { prisma } = await import("../src/db");
const { notify, sendDeferredEmails, sendEmailDigests } =
  await import("../src/modules/notifications/service");
const { flushMail, setMailTransport } = await import("../src/modules/mail/service");
const { memoryTransport } = await import("../src/modules/mail/transports");
const { raggruppa, buildDigestEmail } = await import("../src/modules/mail/digest-mail");

const posta = memoryTransport();
/** Dopo l'attesa: il tempo per leggere l'avviso nella campanella è passato. */
const dopo = (da = new Date()) => new Date(da.getTime() + 16 * 60_000);
let destinatarioId = "";
let attoreId = "";

const avvisa = (type: string, testo: string, taskId?: string) =>
  notify(
    destinatarioId,
    attoreId,
    type as never,
    // Il riferimento è tutto o niente: chi cita un task ne dice anche il tipo.
    taskId
      ? { message: () => testo, taskId, taskKind: TaskKind.PROJECT }
      : { message: () => testo },
  );

beforeAll(async () => {
  setMailTransport(posta);
  destinatarioId = (
    await prisma.user.create({
      data: {
        email: "dario@x.local",
        name: "Dario Ferri",
        role: UserRole.MEMBER,
        emailWeekend: true,
        emailDigest: true,
      },
    })
  ).id;
  attoreId = (
    await prisma.user.create({
      data: {
        email: "giacomo@x.local",
        name: "Giacomo Verdi",
        role: UserRole.MEMBER,
        emailWeekend: true,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  posta.sent.length = 0;
  await prisma.notification.deleteMany({});
});

describe("email aggregate", () => {
  it("mentre si accumulano non parte niente, e la campanella intanto suona", async () => {
    await avvisa(
      NotificationType.TASK_COMMENT,
      'Giacomo ha commentato "Immagini nei commenti"',
      "t1",
    );
    await avvisa(NotificationType.TASK_ASSIGNED, 'Giacomo ti ha assegnato "Lock ticket"', "t2");
    await flushMail();

    expect(posta.sent).toHaveLength(0);
    // Gli avvisi ci sono: è la posta ad aspettare, non l'informazione.
    expect(await prisma.notification.count({ where: { userId: destinatarioId } })).toBe(2);
    expect(await prisma.notification.count({ where: { emailPending: true } })).toBe(2);
  });

  it("il riepilogo li porta via tutti insieme, in un'email sola", async () => {
    for (let i = 0; i < 6; i += 1) {
      await avvisa(NotificationType.TASK_COMMENT, `messaggio ${i}`, i < 4 ? "t1" : "t2");
    }
    await flushMail();
    expect(posta.sent).toHaveLength(0);

    // Prima dell'attesa il riepilogo non li prende: c'è ancora tempo per leggerli.
    expect(await sendEmailDigests()).toBe(0);
    expect(await sendEmailDigests(dopo())).toBe(1);
    expect(posta.sent).toHaveLength(1);
    // Sei avvisi su due record: l'oggetto conta gli avvisi, il corpo raggruppa.
    expect(posta.sent[0]!.subject).toContain("6");
    expect(posta.sent[0]!.text).toContain("messaggio 3");
    expect(await prisma.notification.count({ where: { emailPending: true } })).toBe(0);
  });

  it("un secondo giro non rimanda niente", async () => {
    await avvisa(NotificationType.TASK_COMMENT, "una cosa sola", "t1");
    expect(await sendEmailDigests(dopo())).toBe(1);
    posta.sent.length = 0;
    expect(await sendEmailDigests(dopo())).toBe(0);
    expect(posta.sent).toHaveLength(0);
  });

  it("se la posta è guasta gli avvisi restano in coda, non si perdono", async () => {
    await avvisa(NotificationType.TASK_COMMENT, "da recapitare", "t1");
    setMailTransport({
      name: "guasto",
      send: () => Promise.reject(new Error("connessione rifiutata")),
    });
    expect(await sendEmailDigests(dopo())).toBe(0);
    expect(await prisma.notification.count({ where: { emailPending: true } })).toBe(1);

    // Rimessa in piedi la posta, il giro dopo li porta via.
    setMailTransport(posta);
    expect(await sendEmailDigests(dopo())).toBe(1);
    expect(await prisma.notification.count({ where: { emailPending: true } })).toBe(0);
  });

  it("chi non ha chiesto l'aggregazione riceve le email una per una, dopo l'attesa", async () => {
    const subito = await prisma.user.create({
      data: {
        email: "vera@x.local",
        name: "Vera Verdi",
        role: UserRole.MEMBER,
        emailWeekend: true,
      },
    });
    await notify(subito.id, attoreId, NotificationType.TASK_ASSIGNED, {
      message: () => "un task per te",
      taskId: "t9",
      taskKind: TaskKind.PROJECT,
    });
    await flushMail();
    // Sul momento niente: c'è il tempo per leggerlo nella campanella.
    expect(posta.sent).toHaveLength(0);
    expect(await sendDeferredEmails()).toBe(0);
    // Il riepilogo non è affar suo: le sue email partono da sole.
    expect(await sendEmailDigests(dopo())).toBe(0);
    expect(await sendDeferredEmails(dopo())).toBe(1);
    await flushMail();
    expect(posta.sent).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: subito.id, emailPending: true } }),
    ).toBe(0);
    // Un secondo giro non la rimanda.
    expect(await sendDeferredEmails(dopo())).toBe(0);
  });

  it("per un cliente del portale l'email parte subito, come prima", async () => {
    // Il portale resta com'era (25/09/2026): l'attesa è dell'applicazione interna.
    const cliente = await prisma.user.create({
      data: {
        email: "clara@cliente.example",
        name: "Clara Cliente",
        role: UserRole.PORTAL,
        emailWeekend: true,
      },
    });
    await notify(cliente.id, attoreId, NotificationType.TICKET_UPDATE, {
      message: () => "la tua richiesta ha una risposta",
    });
    await flushMail();
    expect(posta.sent).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: cliente.id, emailPending: true } }),
    ).toBe(0);
  });

  it("letto nella campanella prima che l'email parta, l'email non parte più", async () => {
    // «Se ho letto la notifica da ui la mail non importa» (25/09/2026): vale
    // per le email singole e per il riepilogo.
    const vera = await prisma.user.findUniqueOrThrow({ where: { email: "vera@x.local" } });
    await notify(vera.id, attoreId, NotificationType.TASK_ASSIGNED, {
      message: () => "già visto",
      taskId: "t10",
      taskKind: TaskKind.PROJECT,
    });
    await avvisa(NotificationType.TASK_COMMENT, "già visto anche questo", "t1");
    await prisma.notification.updateMany({ data: { readAt: new Date() } });

    expect(await sendDeferredEmails(dopo())).toBe(0);
    expect(await sendEmailDigests(dopo())).toBe(0);
    await flushMail();
    expect(posta.sent).toHaveLength(0);
    // E la coda è vuota: nessuno la ritroverà in un giro successivo.
    expect(await prisma.notification.count({ where: { emailPending: true } })).toBe(0);
  });
});

describe("come si raggruppa un riepilogo", () => {
  const voce = (text: string, taskId: string | null, minuto: number) => ({
    type: NotificationType.TASK_COMMENT,
    text,
    taskId,
    taskKind: TaskKind.PROJECT,
    createdAt: new Date(2026, 8, 4, 16, minuto),
  });

  it("più avvisi sullo stesso record valgono per uno, e si legge il più recente", () => {
    const gruppi = raggruppa([
      voce("primo messaggio", "t1", 27),
      voce("secondo messaggio", "t1", 32),
      voce("terzo messaggio", "t1", 35),
      voce("altro record", "t2", 34),
    ]);
    expect(gruppi).toHaveLength(2);
    expect(gruppi[0]).toMatchObject({ text: "terzo messaggio", count: 3, taskId: "t1" });
    expect(gruppi[1]).toMatchObject({ text: "altro record", count: 1 });
  });

  it("chi non parla di un record resta per conto suo", () => {
    // Il riepilogo scadenze e gli avvisi di sistema non hanno un task dietro:
    // accorparli nasconderebbe cose diverse sotto la stessa riga.
    const gruppi = raggruppa([
      voce("Scadenze: 9 in ritardo", null, 7),
      voce("Timesheet da compilare", null, 8),
    ]);
    expect(gruppi).toHaveLength(2);
  });
});

describe("il weekend", () => {
  const SABATO = new Date("2026-09-05T08:00:00Z");
  const LUNEDI = new Date("2026-09-07T05:00:00Z");

  beforeEach(async () => {
    posta.sent.length = 0;
    await prisma.notification.deleteMany({ where: { userId: destinatarioId } });
    await prisma.user.update({
      where: { id: destinatarioId },
      data: { emailDigest: false, emailWeekend: false },
    });
  });

  it("di sabato l'email aspetta, anche per chi non aggrega; lunedì parte in un riepilogo", async () => {
    await notify(
      destinatarioId,
      attoreId,
      NotificationType.MENTION,
      { message: () => "Sabato" },
      { now: SABATO },
    );
    await flushMail();
    expect(posta.sent).toHaveLength(0);
    const riga = await prisma.notification.findFirstOrThrow({ where: { userId: destinatarioId } });
    expect(riga.emailPending).toBe(true);
    expect(riga.inApp).toBe(true); // la campanella suona comunque
    expect(await sendEmailDigests(SABATO)).toBe(0);
    expect(await sendDeferredEmails(LUNEDI)).toBe(0);
    expect(await sendEmailDigests(LUNEDI)).toBe(1);
    expect(posta.sent[0]!.text).toContain("Sabato");
  });

  it("chi ha chiesto le email anche nel weekend le riceve, dopo l'attesa", async () => {
    await prisma.user.update({ where: { id: destinatarioId }, data: { emailWeekend: true } });
    await notify(
      destinatarioId,
      attoreId,
      NotificationType.MENTION,
      { message: () => "Subito" },
      { now: SABATO },
    );
    expect(await sendDeferredEmails(dopo(SABATO))).toBe(1);
    await flushMail();
    expect(posta.sent).toHaveLength(1);
  });

  it("dopo il weekend, dei riepiloghi scadenze accumulati si legge solo l'ultimo", async () => {
    for (const giorno of ["2026-09-05T05:00:00Z", "2026-09-06T05:00:00Z", "2026-09-07T05:00:00Z"]) {
      await notify(
        destinatarioId,
        null,
        NotificationType.DUE_DIGEST,
        { message: () => `Scadenze del ${giorno.slice(0, 10)}` },
        { now: new Date(giorno) },
      );
    }
    // il lunedì alle 7 l'avviso di oggi non è nel weekend: parte da solo, gli altri due
    // (trattenuti nel weekend) arrivano insieme nel riepilogo
    expect(await sendDeferredEmails(dopo(LUNEDI))).toBe(1);
    await flushMail();
    expect(posta.sent).toHaveLength(1);
    posta.sent.length = 0;
    expect(await sendEmailDigests(dopo(LUNEDI))).toBe(1);
    expect(posta.sent[0]!.text).toContain("2026-09-06");
    expect(posta.sent[0]!.text).not.toContain("2026-09-05");
    expect(
      await prisma.notification.count({ where: { userId: destinatarioId, emailPending: true } }),
    ).toBe(0);
  });
});

describe("i collegamenti del riepilogo", () => {
  it("le scadenze portano alle bacheche, il timesheet al timesheet, un task al task — e si vedono", () => {
    const email = buildDigestEmail({
      to: "dario@x.local",
      locale: "it",
      recipientName: "Dario",
      appName: "KeelOps",
      baseUrl: "https://keelops.example",
      entries: [
        {
          type: NotificationType.DUE_DIGEST,
          text: "Scadenze: 12 in ritardo",
          taskId: null,
          taskKind: null,
          createdAt: new Date(),
        },
        {
          type: NotificationType.TIMESHEET_REMINDER,
          text: "Timesheet da completare",
          taskId: null,
          taskKind: null,
          createdAt: new Date(),
        },
        {
          type: NotificationType.MENTION,
          text: "Ti ha citato",
          taskId: "t1",
          taskKind: TaskKind.PROJECT,
          createdAt: new Date(),
        },
      ],
    });
    expect(email.html).toContain('href="https://keelops.example/bacheche"');
    expect(email.html).toContain('href="https://keelops.example/timesheet"');
    expect(email.html).toContain('href="https://keelops.example/bacheche?task=t1"');
    expect(email.html).toContain("text-decoration:underline");
    expect(email.text).toContain("https://keelops.example/bacheche");
  });
});
