// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("modifica progetto: il form parte dai dati salvati", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Progetti" }).click();

  // Menu contestuale (tasto destro) sulla card del progetto demo.
  const card = page.getByRole("link", { name: /Sito web aziendale/ });
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Modifica" }).click();

  // L'editor riprende i dati salvati, non parte vuoto.
  const dialog = page.getByRole("dialog", { name: "Modifica progetto" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nome")).toHaveValue("Sito web aziendale");
  // La descrizione è un editor di testo ricco, non un campo con un valore:
  // il testo salvato si legge dentro l'editor.
  await expect(dialog.getByText(/Restyling del sito/)).toBeVisible();
});
