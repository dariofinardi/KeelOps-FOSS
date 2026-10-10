// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("login errato mostra un errore", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("admin@kancrm.local");
  await page.getByLabel("Password").fill("password-sbagliata");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByText("Credenziali non valide")).toBeVisible();
});

test("login corretto porta alla dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("link", { name: "La mia giornata" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "La mia giornata" })).toBeVisible();
});

test("la scorciatoia ? apre l'elenco scorciatoie ed Esc lo chiude", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Shift+?");
  const dialog = page.getByRole("dialog", { name: "Scorciatoie da tastiera" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
