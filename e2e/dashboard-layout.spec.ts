// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * **I riquadri della giornata si dispongono e si chiudono, e il browser se
 * lo ricorda** (07/09/2026): maniglia a sinistra del titolo, bottone per
 * chiudere in fondo a destra, disposizione in localStorage.
 */
const riquadro = (page: Page, titolo: RegExp) =>
  page
    .locator("section[data-riquadro]")
    .filter({ has: page.getByRole("heading", { level: 3, name: titolo }) });

test("un riquadro chiuso resta chiuso dopo il ricaricamento", async ({ page }) => {
  await login(page);
  const ritardo = riquadro(page, /In ritardo/);
  await expect(ritardo).toBeVisible();
  await ritardo.getByTitle("Chiudi la sezione").click();
  await expect(ritardo.getByTitle("Apri la sezione")).toBeVisible();
  await page.reload();
  const dopo = riquadro(page, /In ritardo/);
  await expect(dopo.getByTitle("Apri la sezione")).toBeVisible();
  // e si riapre
  await dopo.getByTitle("Apri la sezione").click();
  await expect(dopo.getByTitle("Chiudi la sezione")).toBeVisible();
});

test("un riquadro si trascina dalla maniglia in un altro punto, e ci resta", async ({ page }) => {
  await login(page);
  const oggi = riquadro(page, /In scadenza oggi/);
  const ritardo = riquadro(page, /In ritardo/);
  await expect(oggi).toBeVisible();
  const maniglia = oggi.getByLabel("Sposta il riquadro");
  const da = (await maniglia.boundingBox())!;
  const a = (await ritardo.boundingBox())!;
  // dnd-kit parte dopo 6px: si trascina a passi, come farebbe una mano
  await page.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
  await page.mouse.down();
  await page.mouse.move(da.x + da.width / 2 + 10, da.y + da.height / 2 + 10, { steps: 4 });
  await page.mouse.move(a.x + a.width / 2, a.y + 10, { steps: 12 });
  await page.mouse.up();

  const ordine = async () =>
    page
      .locator('section[data-colonna="sinistra"] section[data-riquadro]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-riquadro")));
  await expect.poll(ordine).toEqual(expect.arrayContaining(["dueToday", "overdue"]));
  expect((await ordine()).indexOf("dueToday")).toBeLessThan((await ordine()).indexOf("overdue"));
  await page.reload();
  await expect(riquadro(page, /In ritardo/)).toBeVisible();
  expect((await ordine()).indexOf("dueToday")).toBeLessThan((await ordine()).indexOf("overdue"));
});
