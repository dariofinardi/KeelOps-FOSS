// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * **La maniglia della conversazione, nel browser vero.**
 *
 * Scritta perché il trascinamento è stato dichiarato funzionante due volte
 * mentre non funzionava (20/08/2026): in jsdom `PointerEvent` non esiste, quindi
 * i test unitari provavano il ripiego di Testing Library e non il gesto. Questo
 * gesto lo fa davvero — mouse premuto, mosso, rilasciato — e guarda l'altezza
 * misurata dell'elemento, non una classe.
 */
test("la conversazione si allarga trascinando il divisore", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Bacheche" }).click();
  await page.getByRole("button", { name: "Tabella" }).click();

  const titolo = `Maniglia E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nuovo task", exact: true }).click();
  const finestra = page.getByRole("dialog", { name: "Nuovo task" });
  await finestra.getByLabel("Titolo").fill(titolo);
  await finestra.getByRole("button", { name: "Crea task" }).click();
  await expect(finestra).not.toBeVisible();

  await page
    .getByRole("row", { name: new RegExp(titolo) })
    .locator(".task-title")
    .click();
  const pannello = page.getByRole("dialog", { name: titolo });
  await expect(pannello).toBeVisible();

  // Qualche messaggio, o la chat è più corta della sua zona e la barra
  // appiccicata in fondo non avrebbe niente da dimostrare.
  const scrivi = pannello.getByPlaceholder(/Scrivi un commento/);
  for (const testo of ["primo", "secondo", "terzo", "quarto", "quinto", "sesto"]) {
    await scrivi.fill(`messaggio ${testo}`);
    await scrivi.press("Enter");
    await expect(pannello.getByText(`messaggio ${testo}`)).toBeVisible();
  }

  const maniglia = pannello.getByRole("separator", { name: /Altezza della conversazione/ });
  await expect(maniglia).toBeVisible();

  const zonaChat = pannello.locator("[data-chat]");
  const prima = (await zonaChat.boundingBox())!.height;

  // Il gesto vero: premi sulla banda, sali di 120 pixel, rilascia.
  const banda = (await maniglia.boundingBox())!;
  await page.mouse.move(banda.x + banda.width / 2, banda.y + banda.height / 2);
  await page.mouse.down();
  await page.mouse.move(banda.x + banda.width / 2, banda.y - 120, { steps: 12 });
  await page.mouse.up();

  const dopo = (await zonaChat.boundingBox())!.height;
  expect(dopo).toBeGreaterThan(prima + 40);

  // Il campo per rispondere resta a vista anche risalendo in cima alla chat:
  // stretta o larga che sia, si scrive senza prima scorrere fino in fondo.
  const campo = pannello.getByPlaceholder(/Scrivi un commento/);
  await expect(campo).toBeInViewport();
  await zonaChat.evaluate((zona) => zona.scrollTo({ top: 0 }));
  await expect(campo).toBeInViewport();
  const fondoChat = (await zonaChat.boundingBox())!;
  const fondoCampo = (await campo.boundingBox())!;
  // Appiccicato in fondo alla SUA zona, non alla pagina.
  expect(fondoCampo.y + fondoCampo.height).toBeLessThanOrEqual(fondoChat.y + fondoChat.height + 2);

  // E il chevron la chiude del tutto.
  await pannello.getByRole("button", { name: "Riduci la conversazione" }).click();
  await expect(zonaChat).toBeHidden();
});

/**
 * **La stessa maniglia in ogni pannello.**
 *
 * Il meccanismo è nato nel pannello del task e ci era rimasto: la richiesta
 * aveva la stessa zona ancorata ma senza maniglia, l'offerta nemmeno quella
 * (24/08/2026). Ora è un componente solo — `ChatDock` — e questa prova lo
 * verifica dove si vede per primo: sulla richiesta, dal desk.
 */
test("anche nella richiesta la conversazione si allarga", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Ticket" }).click();
  // Il desk parte dalle proprie richieste: quella del seed è di Carla Cliente,
  // e la si sceglie nel filtro delle persone.
  const filtroPersone = page.getByLabel("Richieste di");
  const vocePerCarla = await filtroPersone.locator("option", { hasText: "Carla Cliente" }).textContent();
  await filtroPersone.selectOption({ label: vocePerCarla!.trim() });

  // La richiesta storica del seed: quelle nate come task di progetto il desk
  // le apre nel pannello del task, che questa prova copre già.
  // Sul TITOLO: la riga è un bottone che contiene anche priorità e stato, e un
  // clic al centro finirebbe su quelli.
  await page
    .getByRole("button", { name: /Errore stampa etichette/ })
    .getByText(/Errore stampa etichette/)
    .click();
  const pannello = page.getByRole("dialog", { name: /Errore stampa etichette/ });
  await expect(pannello).toBeVisible();

  const maniglia = pannello.getByRole("separator", { name: /Altezza della conversazione/ });
  await expect(maniglia).toBeVisible();
  const zonaChat = pannello.locator("[data-chat]");
  const prima = (await zonaChat.boundingBox())!.height;

  const banda = (await maniglia.boundingBox())!;
  await page.mouse.move(banda.x + banda.width / 2, banda.y + banda.height / 2);
  await page.mouse.down();
  await page.mouse.move(banda.x + banda.width / 2, banda.y - 120, { steps: 12 });
  await page.mouse.up();

  expect((await zonaChat.boundingBox())!.height).toBeGreaterThan(prima + 40);
  await pannello.getByRole("button", { name: "Riduci la conversazione" }).click();
  await expect(zonaChat).toBeHidden();
});
