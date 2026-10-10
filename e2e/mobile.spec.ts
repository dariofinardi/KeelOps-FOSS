// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Viewport da smartphone: verifica menu hamburger, navigazione e vista giorno.
test.use({ viewport: { width: 390, height: 844 } });

test("su mobile il menu hamburger naviga e il timesheet mostra la vista giorno", async ({
  page,
}) => {
  await login(page);

  // La sidebar fissa è nascosta; si naviga dal menu hamburger.
  await page.getByRole("button", { name: "Menu" }).click();
  const nav = page.getByRole("dialog", { name: "Menu di navigazione" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Timesheet" }).click();
  await expect(nav).not.toBeVisible();

  // Vista giorno mobile: totale del giorno e navigazione ‹ ›.
  await expect(page.getByText(/Totale giorno:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Giorno precedente" })).toBeVisible();
});

test("su mobile la ricerca si apre dall'icona", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Cerca" }).click();
  const panel = page.getByRole("dialog", { name: "Ricerca globale" });
  await expect(panel).toBeVisible();
  await panel.getByPlaceholder("Cerca ovunque…").fill("Versamento IVA");
  await expect(panel.getByRole("button", { name: /Versamento IVA mensile/ }).first()).toBeVisible();
});

/**
 * Nessuna vista scorre di lato.
 *
 * È la difesa della correzione del 16/08/2026: la dashboard sul telefono si
 * apriva con una barra di scorrimento orizzontale — mezza riga fuori schermo,
 * titoli tagliati, e per leggere una data bisognava trascinare la pagina. La
 * causa era un elemento di griglia senza `min-w-0` (che quindi non scende sotto
 * la larghezza minima del contenuto), e la stessa distrazione si ripete facile:
 * basta un `w-96` in una barra o una riga di filtri che non va a capo.
 *
 * Quando fallisce, dice **chi** sfora: il primo elemento che esce dallo schermo
 * senza che sia colpa del padre.
 */
const MOBILE_ROUTES = [
  "/",
  "/bacheche",
  "/progetti",
  "/timesheet",
  "/contatti",
  "/ticket",
  "/utenti",
  "/stati",
  "/profilo",
  "/guida",
];

// Un accesso solo per tutte le rotte: dieci accessi di fila finivano contro
// l'anti-forza-bruta (dieci tentativi per indirizzo IP), e gli ultimi scenari
// fallivano sulla pagina di accesso invece che su quello che dovevano provare.
test("su mobile nessuna vista scorre di lato", async ({ page }) => {
  await login(page);
  const sforano: string[] = [];
  for (const route of MOBILE_ROUTES) {
    await page.goto(route);
    await page.waitForTimeout(800);
    const report = await page.evaluate(() => {
      const width = window.innerWidth;
      const over = (el: Element) => el.getBoundingClientRect().right > width + 1;
      const guilty = Array.from(document.querySelectorAll("main *"))
        .filter((el) => el.getBoundingClientRect().width > 0 && over(el))
        // Il colpevole è il più esterno: se sfora anche il padre, è del padre.
        .filter((el) => !(el.parentElement && over(el.parentElement)))
        .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`);
      const main = document.querySelector("main")!;
      return {
        page: Math.round(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        // Le bacheche kanban scorrono di lato **di proposito**: si guarda una
        // colonna per volta. Quello che non deve scorrere è la pagina.
        main: Math.round(main.scrollWidth - main.clientWidth),
        guilty: guilty.slice(0, 3),
      };
    });
    if (report.page > 0 || report.main > 0) {
      sforano.push(
        `${route}: pagina +${report.page}px, contenuto +${report.main}px — ${report.guilty.join(", ")}`,
      );
    }
  }
  expect(sforano, "viste che sforano in larghezza su uno schermo da 390px").toEqual([]);
});
