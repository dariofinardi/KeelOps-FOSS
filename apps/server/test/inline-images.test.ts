// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";
import { inlineImagesScenario, multipart, PNG } from "./support/inline-images-scenario";

/**
 * Figure incollate in una descrizione **prima che il record esista**
 * (14/08/2026).
 *
 * Il giro completo: si incolla → la figura sta in attesa e la vede solo chi
 * l'ha incollata → si salva → trasloca accanto al record, l'indirizzo dentro
 * l'HTML viene riscritto, e da lì in poi la vede chi vede il record. Quello che
 * resta in attesa (dialogo abbandonato) lo spazza il cron.
 */
const { tempDir } = prepareTestDb("inline-images");

const { pendingKey, purgePendingInlineImages, PENDING_TTL_HOURS } = await import(
  "../src/modules/rich-text/inline-images"
);
const { attachmentStore } = await import("../src/modules/attachments/store");

let ctx: Awaited<ReturnType<typeof inlineImagesScenario>>;
let app: typeof ctx.app;
let prisma: typeof ctx.prisma;
let autoreCookie: string;
let collegaCookie: string;
let projectId: string;
let statusId: string;
let incolla: typeof ctx.incolla;

beforeAll(async () => {
  ctx = await inlineImagesScenario();
  ({ app, prisma, autoreCookie, collegaCookie, projectId, statusId, incolla } = ctx);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("figure in attesa", () => {
  it("si incolla senza avere un record, e la rilegge solo chi l'ha incollata", async () => {
    const url = await incolla(autoreCookie);
    expect(url).toMatch(/^\/api\/inline-images\/pending\/[0-9a-f-]{36}\.png$/);

    const mia = await app.inject({ method: "GET", url, headers: { cookie: autoreCookie } });
    expect(mia.statusCode).toBe(200);
    expect(mia.headers["content-type"]).toContain("image/png");

    // Finché il record non esiste non c'è nessun permesso da ereditare: la
    // figura è di chi la sta scrivendo, e per gli altri non esiste.
    const altrui = await app.inject({ method: "GET", url, headers: { cookie: collegaCookie } });
    expect(altrui.statusCode).toBe(404);
  });

  it("valgono le stesse regole del caricamento sul task: solo immagini", async () => {
    const { body, headers } = multipart("documento.pdf", "application/pdf", PNG);
    const response = await app.inject({
      method: "POST",
      url: "/api/inline-images",
      headers: { ...headers, cookie: autoreCookie },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("il salvataggio lega le figure al record", () => {
  it("nuovo task: la figura trasloca e l'indirizzo viene riscritto", async () => {
    const url = await incolla(autoreCookie);
    const id = url.split("/").pop()!.replace(".png", "");

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: autoreCookie },
      payload: {
        title: "Task con schermata",
        statusId,
        description: `<p>Ecco il problema:</p><img src="${url}">`,
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id;

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    // L'indirizzo provvisorio non deve sopravvivere al salvataggio.
    expect(task.description).not.toContain("/api/inline-images/pending/");
    expect(task.description).toContain(`/api/tasks/${taskId}/inline/${id}.png`);
    // Il file è traslocato accanto al task, e l'attesa è finita.
    expect(await attachmentStore().exists(pendingKey(id, ".png"))).toBe(false);
    expect(await attachmentStore().exists(`${taskId}/_inline/${id}.png`)).toBe(true);
    expect(await prisma.pendingInlineImage.findUnique({ where: { id } })).toBeNull();

    // Da qui vale la regola di sempre: chi vede il task vede la figura.
    const letta = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/inline/${id}.png`,
      headers: { cookie: autoreCookie },
    });
    expect(letta.statusCode).toBe(200);
  });

  it("nuovo task di progetto: stessa porta, stesso esito", async () => {
    const url = await incolla(autoreCookie);
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: autoreCookie },
      payload: {
        title: "Task di progetto con schermata",
        projectId,
        description: `<p>Vedi qui:</p><img src="${url}">`,
      },
    });
    expect(created.statusCode).toBe(201);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: created.json().id } });
    expect(task.description).toContain(`/api/tasks/${task.id}/inline/`);
    expect(task.description).not.toContain("pending");
  });

  it("non si trascinano le figure di un altro citandone l'indirizzo", async () => {
    // L'indirizzo provvisorio di Clara, incollato da Aldo in un suo task: la
    // figura non è sua e deve restare dov'è.
    const altrui = await incolla(collegaCookie);
    const id = altrui.split("/").pop()!.replace(".png", "");
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: autoreCookie },
      payload: { title: "Furto di figura", statusId, description: `<img src="${altrui}">` },
    });
    expect(created.statusCode).toBe(201);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: created.json().id } });
    expect(task.description).toContain("/api/inline-images/pending/");
    expect(await attachmentStore().exists(pendingKey(id, ".png"))).toBe(true);
    expect(await prisma.pendingInlineImage.findUnique({ where: { id } })).not.toBeNull();
  });

  it("una descrizione senza figure non fa scrivere niente in più", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { cookie: autoreCookie },
      payload: { title: "Task normale", statusId, description: "<p>Solo testo</p>" },
    });
    expect(created.statusCode).toBe(201);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: created.json().id } });
    expect(task.description).toBe("<p>Solo testo</p>");
  });
});

describe("pulizia delle figure mai salvate", () => {
  it("il cron toglie solo quelle vecchie: le fresche restano", async () => {
    const fresca = await incolla(autoreCookie);
    const vecchia = await incolla(autoreCookie);
    const idFresca = fresca.split("/").pop()!.replace(".png", "");
    const idVecchia = vecchia.split("/").pop()!.replace(".png", "");
    // Invecchiata a mano oltre la soglia: un dialogo aperto e mai salvato.
    await prisma.pendingInlineImage.update({
      where: { id: idVecchia },
      data: { createdAt: new Date(Date.now() - (PENDING_TTL_HOURS + 1) * 3600 * 1000) },
    });

    const removed = await purgePendingInlineImages();
    expect(removed).toBe(1);
    expect(await attachmentStore().exists(pendingKey(idVecchia, ".png"))).toBe(false);
    expect(await attachmentStore().exists(pendingKey(idFresca, ".png"))).toBe(true);
    expect(await prisma.pendingInlineImage.findUnique({ where: { id: idFresca } })).not.toBeNull();
  });
});
