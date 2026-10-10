// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { NotificationType, TaskKind, UserRole } from "@kancrm/shared";

/**
 * **Campanella ed email si scelgono separatamente.**
 *
 * Erano un interruttore solo: chi riceveva troppa posta lo spegneva, e insieme
 * alla posta perdeva anche l'avviso dentro l'applicazione — cioè finiva per non
 * sapere più niente (04/09/2026). Qui si prova che i due canali sono davvero
 * indipendenti, in tutti e due i versi, e che chi non ha mai scelto li ha
 * entrambi accesi.
 *
 * L'ultima prova è quella che si dimentica: spenta la campanella, la riga in
 * tabella si scrive lo stesso, perché è il registro con cui i riepiloghi
 * giornalieri sanno di aver già scritto oggi. Senza, il riepilogo delle
 * scadenze ripartirebbe a ogni riavvio del server.
 */
const { tempDir } = prepareTestDb("notification-channels");
process.env.MAILER_HOST = "smtp.example";
process.env.APP_BASE_URL = "https://keelops.example";

const { prisma } = await import("../src/db");
const { notify, sendDeferredEmails, sendDueDigests } =
  await import("../src/modules/notifications/service");
const { flushMail, setMailTransport } = await import("../src/modules/mail/service");
const { memoryTransport } = await import("../src/modules/mail/transports");
const { buildApp } = await import("../src/app");
const { hashPassword } = await import("../src/modules/auth/password");
const { SESSION_COOKIE } = await import("../src/modules/auth/session");
const { tipiNotificaPrevisti } = await import("../src/edition/notification-types");

const posta = memoryTransport();
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = "";
let destinatarioId = "";
let attoreId = "";

/** Le due caselle di un tipo, come le vede la persona nel pannello. */
const preferenza = async (type: string) => {
  const risposta = await app.inject({
    method: "GET",
    url: "/api/notification-preferences",
    headers: { cookie },
  });
  return (
    risposta.json() as { items: Array<{ type: string; enabled: boolean; email: boolean }> }
  ).items.find((riga) => riga.type === type)!;
};

const scegli = (body: object) =>
  app.inject({
    method: "PUT",
    url: "/api/notification-preferences",
    headers: { cookie },
    payload: body,
  });

const campanella = async () => {
  const risposta = await app.inject({
    method: "GET",
    url: "/api/notifications",
    headers: { cookie },
  });
  return risposta.json() as { notifications: unknown[]; unreadCount: number };
};

beforeAll(async () => {
  setMailTransport(posta);
  app = await buildApp();
  const passwordHash = await hashPassword("prova-1234");
  destinatarioId = (
    await prisma.user.create({
      data: {
        email: "vera@x.local",
        name: "Vera Verdi",
        role: UserRole.MEMBER,
        emailWeekend: true,
        passwordHash,
      },
    })
  ).id;
  attoreId = (
    await prisma.user.create({
      data: {
        email: "aldo@x.local",
        name: "Aldo Attore",
        role: UserRole.MEMBER,
        emailWeekend: true,
      },
    })
  ).id;
  const accesso = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "vera@x.local", password: "prova-1234" },
  });
  cookie = `${SESSION_COOKIE}=${accesso.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("preferenze: due canali per ogni evento", () => {
  it("chi non ha mai scelto ha tutto acceso, tipo per tipo", async () => {
    const righe = (
      (
        await app.inject({
          method: "GET",
          url: "/api/notification-preferences",
          headers: { cookie },
        })
      ).json() as { items: Array<{ type: string; enabled: boolean; email: boolean }> }
    ).items;
    // The types this edition produces: all of them in the commercial edition.
    expect(righe.length).toBe(tipiNotificaPrevisti().size);
    expect(righe.every((riga) => riga.enabled && riga.email)).toBe(true);
  });

  it("spegnere l'email lascia acceso l'avviso nell'applicazione", async () => {
    posta.sent.length = 0;
    await scegli({ type: NotificationType.TASK_ASSIGNED, email: false });
    expect(await preferenza(NotificationType.TASK_ASSIGNED)).toEqual({
      type: NotificationType.TASK_ASSIGNED,
      enabled: true,
      email: false,
    });

    await notify(destinatarioId, attoreId, NotificationType.TASK_ASSIGNED, {
      message: () => "Ti ho assegnato un task",
      taskId: "task-1",
      taskKind: TaskKind.ADMIN,
    });
    await flushMail();

    expect(posta.sent).toHaveLength(0);
    expect((await campanella()).unreadCount).toBe(1);
  });

  it("spegnere l'avviso nell'applicazione lascia partire l'email", async () => {
    posta.sent.length = 0;
    const prima = (await campanella()).notifications.length;
    await scegli({ type: NotificationType.MENTION, enabled: false });
    // La casella non nominata non si muove: si aggiorna un canale alla volta.
    expect(await preferenza(NotificationType.MENTION)).toEqual({
      type: NotificationType.MENTION,
      enabled: false,
      email: true,
    });

    await notify(destinatarioId, attoreId, NotificationType.MENTION, {
      message: () => "Ti ho citato",
      taskId: "task-2",
      taskKind: TaskKind.ADMIN,
    });
    // Senza campanella l'avviso non si leggerà mai lì: l'email non aspetta, e
    // parte al primo giro della coda.
    await sendDeferredEmails();
    await flushMail();

    expect(posta.sent).toHaveLength(1);
    // Nella campanella non compare niente di nuovo: è proprio ciò che si è spento.
    expect((await campanella()).notifications.length).toBe(prima);
  });

  it("un riepilogo giornaliero senza campanella non si ripete a ogni riavvio", async () => {
    posta.sent.length = 0;
    await scegli({ type: NotificationType.DUE_DIGEST, enabled: false });
    await prisma.taskStatus.create({
      data: { name: "Da fare", category: "ADMIN", color: "#888", order: 0 },
    });
    const stato = await prisma.taskStatus.findFirstOrThrow();
    const ieri = new Date();
    ieri.setUTCDate(ieri.getUTCDate() - 1);
    await prisma.task.create({
      data: {
        title: "Fattura da emettere",
        kind: TaskKind.ADMIN,
        statusId: stato.id,
        creatorId: attoreId,
        assigneeId: destinatarioId,
        dueDate: ieri,
      },
    });

    // Due giri, come due riavvii nello stesso giorno.
    await sendDueDigests(new Date());
    await sendDueDigests(new Date());
    await sendDeferredEmails();
    await sendDeferredEmails();
    await flushMail();

    expect(posta.sent).toHaveLength(1);
    expect(
      (await campanella()).notifications.some((n) => JSON.stringify(n).includes("scadenza")),
    ).toBe(false);
  });
});
