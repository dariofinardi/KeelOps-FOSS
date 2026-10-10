// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * **Trascinare una card fra due colonne, nel browser vero.**
 *
 * Da quando ogni colonna scorre per conto suo, il suo riquadro ritaglia: la
 * card trascinata scivolava *sotto* le colonne accanto invece che sopra
 * (20/08/2026). Si disegna nel `DragOverlay`, che sta fuori da ogni riquadro —
 * e questo lo verifica sia il gesto sia l'esito.
 */
test("una card si trascina in un'altra colonna e ci resta", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Bacheche" }).click();
  await page.getByRole("button", { name: "Tabella" }).click();

  const titolo = `Trascina E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nuovo task", exact: true }).click();
  const finestra = page.getByRole("dialog", { name: "Nuovo task" });
  await finestra.getByLabel("Titolo").fill(titolo);
  await finestra.getByRole("button", { name: "Crea task" }).click();
  await expect(finestra).not.toBeVisible();

  await page.getByRole("button", { name: "Kanban" }).click();
  const card = page.getByText(titolo, { exact: true });
  await expect(card).toBeVisible();

  const partenza = (await card.boundingBox())!;
  // La colonna di destinazione: la prima intestazione diversa da quella dove
  // sta adesso la card.
  const colonne = page.locator("[data-colonna]");
  await expect(colonne.first()).toBeVisible();
  const destinazione = (await colonne.nth(1).boundingBox())!;

  await page.mouse.move(partenza.x + partenza.width / 2, partenza.y + partenza.height / 2);
  await page.mouse.down();
  // Passi intermedi: dnd-kit ha bisogno di più di un movimento per iniziare.
  await page.mouse.move(partenza.x + partenza.width / 2 + 20, partenza.y + 10, { steps: 5 });

  await page.mouse.move(destinazione.x + destinazione.width / 2, destinazione.y + 120, {
    steps: 15,
  });

  // **Mentre si trascina**, del titolo ci sono due copie: la card ferma e
  // sbiadita al suo posto, e l'anteprima che segue il puntatore. Quest'ultima
  // deve stare FUORI da ogni colonna, o il riquadro che scorre la ritaglierebbe
  // — che è esattamente il difetto da cui nasce questa prova.
  const copie = page.getByText(titolo, { exact: true });
  await expect(copie).toHaveCount(2);
  const fuoriDalleColonne = await copie.evaluateAll(
    (nodi) => nodi.filter((nodo) => !nodo.closest("[data-colonna]")).length,
  );
  expect(fuoriDalleColonne).toBe(1);

  await page.mouse.up();

  // È finita nella colonna di destinazione, e ci resta dopo il salvataggio.
  await expect(colonne.nth(1).getByText(titolo, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(
    page.locator("[data-colonna]").nth(1).getByText(titolo, { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});
