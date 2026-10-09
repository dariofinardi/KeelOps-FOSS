import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * **La barra orizzontale in fondo alla finestra, non a mezz'aria.**
 *
 * Con le colonne alte quanto il loro contenuto la bacheca cresce, la pagina
 * scorre in verticale e la barra per raggiungere la colonna successiva finisce
 * a metà pagina — o fuori schermo quando una colonna è piena (21/08/2026).
 * È una cosa che si vede solo in un browser vero: nessun test di unità sa dove
 * finisce una barra di scorrimento.
 */
test("la bacheca delle offerte sta nella finestra, e la pagina non scorre", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Offerte" }).click();
  await page.getByRole("button", { name: "Kanban" }).click();

  const bacheca = page.locator('[data-bacheca="offerte"]');
  await expect(bacheca).toBeVisible();

  const misure = await page.evaluate(() => {
    const board = document.querySelector('[data-bacheca="offerte"]')!;
    const r = board.getBoundingClientRect();
    return {
      // Quanto scorre la pagina in verticale: deve essere zero.
      paginaScorre: Math.round(
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
      // Distanza fra il fondo della bacheca e il fondo della finestra.
      distanzaDalFondo: Math.round(window.innerHeight - r.bottom),
      // La bacheca scorre davvero in orizzontale (o non c'è barra da collocare).
      scorreOrizzontale: board.scrollWidth > board.clientWidth,
    };
  });

  expect(misure.paginaScorre).toBeLessThanOrEqual(1);
  // La barra è dentro la finestra, non oltre: qualche decina di pixel di
  // margine è il respiro della pagina, non una bacheca che sfonda.
  expect(misure.distanzaDalFondo).toBeGreaterThanOrEqual(0);
  expect(misure.distanzaDalFondo).toBeLessThan(60);
});
