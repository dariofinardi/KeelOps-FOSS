// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * **«Personale» come plugin, dal browser.** La voce di menù sta dove il
 * manifesto la chiede, la pagina vive nella cornice (`/estensioni/Personale`),
 * e dentro ci si lavora come prima: la «Mia» di benvenuto, una card aggiunta al
 * volo, la scheda della card con l'orario, il trascinamento fra colonne, e
 * sul telefono la pagina non scorre di lato (regola 14). È la prova del
 * passo S3 di plan/plugin-personale.md — la metà che il selftest del plugin,
 * fatto di richieste HTTP, non può vedere.
 */

/** La pagina del plugin dentro la cornice di AppShell. */
async function apriPersonale(page: Page): Promise<FrameLocator> {
  await page.goto("/estensioni/Personale");
  const cornice = page.frameLocator('iframe[title="Personale"]');
  await expect(cornice.getByRole("button", { name: "Mia" })).toBeVisible();
  return cornice;
}

test("la voce di menù è dove il manifesto la chiede: subito dopo la giornata", async ({ page }) => {
  await login(page);
  const voci = page.getByRole("navigation").getByRole("link");
  const nomi = await voci.allInnerTexts();
  const giornata = nomi.findIndex((n) => /La mia giornata/.test(n));
  const personale = nomi.findIndex((n) => /^Personale$/.test(n.trim()));
  expect(giornata).toBeGreaterThanOrEqual(0);
  expect(personale).toBe(giornata + 1);
});

test("la «Mia» c'è al primo accesso, e una card nasce dal titolo", async ({ page }) => {
  await login(page);
  const cornice = await apriPersonale(page);
  // le cinque colonne di serie
  // (dentro la kanban: i nomi delle colonne stanno anche nella tendina del filtro)
  await expect(cornice.locator(".kanban").getByText("Da fare", { exact: true })).toBeVisible();
  await expect(cornice.locator(".kanban").getByText("Fatto", { exact: true })).toBeVisible();

  // aggiunta rapida nella prima colonna
  await cornice.getByTitle("Aggiungi task").first().click();
  await cornice.getByPlaceholder("Titolo del task…").fill("Comprare il latte");
  await cornice.getByPlaceholder("Titolo del task…").press("Enter");
  await expect(cornice.getByText("Comprare il latte")).toBeVisible();

  // la scheda: un orario, salvato e riletto
  await cornice.getByText("Comprare il latte").click();
  await expect(cornice.getByRole("dialog", { name: "Modifica task" })).toBeVisible();
  await cornice.getByLabel("Scadenza", { exact: true }).fill("2026-09-10");
  await cornice.getByLabel("Ora").fill("14:30");
  await cornice.getByRole("button", { name: "Salva" }).click();
  await expect(cornice.getByRole("dialog")).toHaveCount(0);
  await expect(cornice.getByText("14:30")).toBeVisible();
});

test("una card si trascina in un'altra colonna", async ({ page }) => {
  await login(page);
  const cornice = await apriPersonale(page);
  await cornice.getByTitle("Aggiungi task").first().click();
  await cornice.getByPlaceholder("Titolo del task…").fill("Da spostare");
  await cornice.getByPlaceholder("Titolo del task…").press("Enter");
  const card = cornice.getByText("Da spostare");
  await expect(card).toBeVisible();

  // dnd-kit parte dopo 6px: si trascina a passi, come farebbe una mano
  const da = (await card.boundingBox())!;
  const colonnaInCorso = cornice.locator(".colonna", { hasText: "In corso" });
  const a = (await colonnaInCorso.boundingBox())!;
  await page.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
  await page.mouse.down();
  await page.mouse.move(da.x + da.width / 2 + 10, da.y + da.height / 2 + 10, { steps: 4 });
  await page.mouse.move(a.x + a.width / 2, a.y + 80, { steps: 12 });
  await page.mouse.up();

  await expect(colonnaInCorso.getByText("Da spostare")).toBeVisible();
});

test("sul telefono la pagina non scorre di lato: scorre la kanban", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page);
  const cornice = await apriPersonale(page);
  const documento = cornice.locator("html");
  const larghezze = await documento.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(larghezze.scroll).toBeLessThanOrEqual(larghezze.client);
  // e la kanban, sì: cinque colonne da 18rem non ci stanno in 390px
  const kanban = cornice.locator(".kanban");
  const scorre = await kanban.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scorre).toBe(true);
});

test("i filtri restringono le card e si ricordano; la giornata ha la pastiglia «Personali»", async ({
  page,
}) => {
  await login(page);
  const cornice = await apriPersonale(page);
  for (const titolo of ["Pagare la bolletta", "Chiamare il dentista"]) {
    await cornice.getByTitle("Aggiungi task").first().click();
    await cornice.getByPlaceholder("Titolo del task…").fill(titolo);
    await cornice.getByPlaceholder("Titolo del task…").press("Enter");
    await expect(cornice.getByText(titolo)).toBeVisible();
  }
  await cornice.getByPlaceholder("Cerca nelle card…").fill("bolletta");
  await expect(cornice.getByText("Pagare la bolletta")).toBeVisible();
  await expect(cornice.getByText("Chiamare il dentista")).toHaveCount(0);
  await expect(cornice.getByText(/1 di \d+ card/)).toBeVisible();
  // ricordato: ricaricando la pagina il filtro è ancora lì
  await page.reload();
  const dopo = page.frameLocator('iframe[title="Personale"]');
  await expect(dopo.getByPlaceholder("Cerca nelle card…")).toHaveValue("bolletta");
  await dopo.getByRole("button", { name: "Azzera filtri" }).click();
  await expect(dopo.getByText("Chiamare il dentista")).toBeVisible();

  // una scadenza passata: la card finisce nel gruppo «In ritardo» della giornata
  await dopo.getByText("Pagare la bolletta").click();
  await dopo.getByLabel("Scadenza", { exact: true }).fill("2026-01-05");
  await dopo.getByRole("button", { name: "Salva" }).click();
  await expect(dopo.getByRole("dialog")).toHaveCount(0);

  // nella giornata: «In ritardo» ha la terza pastiglia, che apre le card del plugin nel riquadro
  await page.goto("/");
  // il riquadro stesso (l'ultimo: la colonna che lo contiene è una section anche lei)
  const inRitardo = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 3, name: /In ritardo/ }) })
    .last();
  await inRitardo.getByRole("button", { name: /^Personali \(\d+\)$/ }).click();
  await expect(
    inRitardo.frameLocator('iframe[title="Personale"]').getByText("Pagare la bolletta"),
  ).toBeVisible();
});
