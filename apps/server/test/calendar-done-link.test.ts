// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { UserRole } from "@kancrm/shared";

const { tempDir } = prepareTestDb("caldone");

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { signDoneLink } = await import("../src/modules/calendar/done-link");
const { initSigningSecret } = await import("../src/lib/signing");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let token: string;
let taskId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: "u@test.local", name: "Ugo", role: UserRole.MEMBER },
  });
  const open = await prisma.taskStatus.findFirstOrThrow({
    where: { category: "DEV", isClosed: false },
    orderBy: { order: "asc" },
  });
  const project = await prisma.project.create({ data: { name: "Atlante" } });
  const task = await prisma.task.create({
    data: {
      kind: "PROJECT",
      title: "GAN per pulire i documenti",
      projectId: project.id,
      statusId: open.id,
      creatorId: user.id,
      assigneeId: user.id,
      dueDate: new Date("2026-08-20T00:00:00Z"),
    },
  });
  taskId = task.id;
  const feed = await prisma.calendarFeed.create({
    data: { userId: user.id, scope: "MINE", label: "Le mie scadenze", token: "tok-prova" },
  });
  token = feed.token;
  await prisma.appSetting.create({ data: { key: "calendar.feedsEnabled", value: "true" } });
  // Serve alla via d'uscita "Aprilo nell'applicazione": i link assoluti vengono
  // dall'indirizzo pubblico della pagina Email, unica verità.
  await prisma.appSetting.create({
    data: { key: "mail.baseUrl", value: "https://crm.esempio.it" },
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("«segna come fatto» dal calendario", () => {
  const url = (code = signDoneLink(token, taskId)) =>
    `/calendario/fatto/${taskId}?f=${token}&c=${code}`;

  it("la firma sopravvive al riavvio", async () => {
    /**
     * Il difetto vero (18/08/2026): senza `DOWNLOAD_TOKEN_SECRET` nell'ambiente
     * il segreto era casuale **a ogni avvio**, e ogni deploy spegneva in
     * silenzio tutti i link già finiti nei calendari — la pagina poi dava la
     * colpa a un calendario revocato. Qui si simula il riavvio: si firma, si
     * ricarica il segreto come farebbe un processo nuovo, e la firma di prima
     * deve valere ancora.
     */
    const prima = signDoneLink(token, taskId);

    // Il riavvio, per davvero: i moduli si ricaricano da zero, quindi il
    // segreto tenuto in memoria sparisce e va ripreso da dove è conservato.
    vi.resetModules();
    const rinato = await import("../src/lib/signing");
    await rinato.initSigningSecret();
    const dopo = await import("../src/modules/calendar/done-link");
    expect(dopo.signDoneLink(token, taskId)).toBe(prima);

    // E il link scritto prima del riavvio continua ad aprirsi.
    const res = await app.inject({ method: "GET", url: url(prima) });
    expect(res.body).toContain("Segnare come fatto?");
  });

  it("il segreto è conservato, non rigenerato", async () => {
    const row = await prisma.appSetting.findUnique({ where: { key: "security.signingSecret" } });
    expect(row?.value).toBeTruthy();
    // Una seconda inizializzazione non lo sostituisce: sostituirlo sarebbe
    // esattamente il difetto, solo più lento ad arrivare.
    await initSigningSecret();
    const ancora = await prisma.appSetting.findUnique({ where: { key: "security.signingSecret" } });
    expect(ancora?.value).toBe(row?.value);
  });

  it("una firma di un altro task non apre nulla, ma non lascia in un vicolo cieco", async () => {
    const res = await app.inject({ method: "GET", url: url(signDoneLink(token, "altro-task")) });
    expect(res.body).toContain("Collegamento non valido");
    // Chi ci arriva voleva chiudere un task: gli si dice almeno dove farlo.
    expect(res.body).toContain(`https://crm.esempio.it/bacheche?task=${taskId}`);
  });

  it("la pagina di conferma si apre", async () => {
    const res = await app.inject({ method: "GET", url: url() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Segnare come fatto?");
    // La conferma è un modulo POST: un GET che chiude verrebbe premuto dai
    // programmi che visitano i link, non da una persona.
    expect(res.body).toContain('<form method="post">');
  });

  it("il modulo chiude il task", async () => {
    const res = await app.inject({ method: "POST", url: url() });
    expect(res.body).toContain("è stato chiuso");
    const after = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { status: true },
    });
    expect(after.status?.isClosed).toBe(true);
  });
});
