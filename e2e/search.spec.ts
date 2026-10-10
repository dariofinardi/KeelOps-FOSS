// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("la barra porta il fuoco nel campo senza cambiare modo", async ({ page }) => {
  await login(page);
  const search = page.locator("#global-search");
  const before = await search.getAttribute("placeholder");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  // "/" è "portami nel campo", non "passa al globale": il segnaposto (che
  // dichiara il modo) non deve cambiare sotto le mani.
  await expect(search).toHaveAttribute("placeholder", before ?? "");
  // E dentro il campo la barra torna a essere un carattere.
  await search.type("2026/08");
  await expect(search).toHaveValue("2026/08");
});

test("Ctrl+K porta alla ricerca globale e apre un risultato", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+k");
  const search = page.locator("#global-search");
  await expect(search).toBeFocused();

  await search.fill("Versamento IVA");
  const result = page.getByRole("button", { name: /Versamento IVA mensile/ }).first();
  await expect(result).toBeVisible();
  await result.click();

  const drawer = page.getByRole("dialog", { name: /Versamento IVA mensile/ });
  await expect(drawer).toBeVisible();
});
