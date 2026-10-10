// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("creazione di un task dallo Scadenzario e apertura del dettaglio", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Bacheche" }).click();
  await page.getByRole("button", { name: "Tabella" }).click();

  const title = `Task E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nuovo task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo task" });
  await dialog.getByLabel("Titolo").fill(title);

  // Allega al volo un link e un file mentre si crea il task.
  await dialog.getByRole("button", { name: "Link" }).click();
  await dialog.getByPlaceholder(/Titolo/).fill("Riferimento");
  await dialog.getByPlaceholder(/drive\.google/).fill("https://example.com/x");
  await dialog.getByRole("button", { name: "Aggiungi link" }).click();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles([{ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("ciao") }]);
  await expect(dialog.getByText("nota.txt")).toBeVisible();

  await dialog.getByRole("button", { name: "Crea task" }).click();
  await expect(dialog).not.toBeVisible();

  // Il task compare in tabella; il click apre il drawer di dettaglio.
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toBeVisible();
  // Click sul titolo, non al centro della riga: le celle di stato, assegnatario e
  // tipo si modificano al click e non aprono il dettaglio (comportamento voluto).
  await row.locator(".task-title").click();
  const drawer = page.getByRole("dialog", { name: title });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Attività", { exact: true })).toBeVisible();
  // Gli allegati messi in coda sono stati caricati sul task creato
  // (compaiono nell'elenco allegati e nella timeline: basta il primo match).
  await expect(drawer.getByText("Riferimento").first()).toBeVisible();
  await expect(drawer.getByText("nota.txt").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});
