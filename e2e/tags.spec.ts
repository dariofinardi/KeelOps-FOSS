// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("crea un task, gli applica un tag e filtra la tabella per tag", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Bacheche" }).click();
  await page.getByRole("button", { name: "Tabella" }).click();

  const title = `Task tag ${Date.now()}`;
  const tag = `e2e-${Date.now()}`;

  // Crea un task.
  await page.getByRole("button", { name: "Nuovo task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo task" });
  await dialog.getByLabel("Titolo").fill(title);
  await dialog.getByRole("button", { name: "Crea task" }).click();
  await expect(dialog).not.toBeVisible();

  // Apri il dettaglio e crea+applica un tag al volo.
  const row = page.getByRole("row", { name: new RegExp(title) });
  await row.locator(".task-title").click();
  const drawer = page.getByRole("dialog", { name: title });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder("Aggiungi un tag…").fill(tag);
  await drawer.getByRole("button", { name: new RegExp(`Crea tag`) }).click();
  // Il chip del tag compare nell'editor.
  await expect(drawer.getByText(tag, { exact: true })).toBeVisible();

  // Il tag è una modifica salvata: se il pannello ha già riletto il task,
  // chiudendo chiede se tenerla (regola del pannello che salva campo per
  // campo). Se la rilettura non è ancora arrivata si chiude e basta.
  await page.keyboard.press("Escape");
  const mantieni = page.getByRole("button", { name: "Mantieni le modifiche" });
  await expect(async () => {
    if (await mantieni.isVisible()) await mantieni.click();
    await expect(drawer).toBeHidden({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  // Il filtro per tag sta nella barra in alto: una tendina con ricerca, che
  // senza una scelta è già la casella. Applicato, mostra solo il task taggato.
  await page.getByPlaceholder("Cerca un tag…").fill(tag);
  // La voce si clicca quando dice «(1)»: vuol dire che i tag sono stati
  // riletti dopo la creazione e la lista non cambierà più sotto il puntatore —
  // prima, ridisegnandosi fra il puntamento e il clic, il clic finiva sul
  // selettore di vista che sta sotto la tendina.
  const voce = page.getByRole("button", { name: new RegExp(`^${tag} \\(1\\)$`) });
  // I tag si rileggono dopo il salvataggio del task, con il loro giro di rete.
  await expect(voce).toBeVisible({ timeout: 15_000 });
  await voce.click();
  await expect(page.getByRole("button", { name: new RegExp(`^${tag} \\(1\\)$`) })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByRole("row").filter({ hasText: "Versamento IVA" })).toHaveCount(0);

  // Il filtro si ricorda (regola 7): ricaricando, la tabella riparte col tag
  // scelto e con lo stesso solo task. La vista invece si sceglie di nuovo.
  await page.reload();
  await page.getByRole("button", { name: "Tabella" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${tag} \\(1\\)$`) })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByRole("row").filter({ hasText: "Versamento IVA" })).toHaveCount(0);
});
