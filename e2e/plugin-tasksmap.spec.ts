// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * **«TasksMap» dal browser.** La mappa si apre dal menu a tre puntini della
 * pagina del progetto, vive nella cornice (`/estensioni/TasksMap`) e disegna
 * i task di quel progetto — quelli che l'utente vede — con i temi calcolati
 * sul posto (tf-idf sul banco di prova: niente Ollama). È la metà che il
 * selftest del plugin, fatto di richieste HTTP, non può vedere.
 */
test("la mappa si apre dal progetto e disegna i suoi task", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Progetti" }).click();
  await page.getByRole("link", { name: /Sito web aziendale/ }).click();
  await expect(page.getByRole("heading", { name: "Sito web aziendale" })).toBeVisible();

  await page.getByRole("button", { name: "Plugin" }).click();
  await page.getByRole("menuitem", { name: "Mappa" }).click();
  await expect(page).toHaveURL(/\/estensioni\/TasksMap\?progetto=/);

  const cornice = page.frameLocator('iframe[title="Mappa"]');
  await expect(cornice.locator("#progetto-nome")).toHaveText("Sito web aziendale");
  // il progetto demo ha tre task: la didascalia li conta e dice da dove vengono i temi
  await expect(cornice.locator("#caption")).toContainText(/3 task · temi da tf-idf/);
  await expect(cornice.locator("#canvas")).toBeVisible();
  // il filtro per testo trova un task e lo dice
  await cornice.locator("#cerca").fill("Mappa del sito");
  await expect(cornice.locator("#caption")).toContainText(/1 task corrispond/);
});
