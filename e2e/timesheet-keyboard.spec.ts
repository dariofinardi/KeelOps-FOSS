import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * **La griglia delle ore si usa da tastiera, nel browser vero.**
 *
 * I gesti di un foglio di calcolo: frecce per spostarsi, una cifra per entrare
 * in scrittura, Invio per confermare e scendere, Esc per rimettere il valore di
 * prima (richiesta del 26/08/2026). In jsdom il fuoco e la selezione si
 * simulano; qui si preme davvero, e si guarda dove finisce il cursore.
 */
test("frecce, cifre, Invio ed Esc nella griglia del timesheet", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Timesheet" }).click();

  // Serve una riga: si aggiunge un task alla griglia dal selettore.
  // due selettori in pagina (settimana e giornata): quello visibile è uno solo
  const aggiungi = page.getByPlaceholder(/Aggiungi un task alla griglia/).first();
  await expect(aggiungi).toBeVisible();
  await aggiungi.click();
  // a periodo vuoto il selettore non propone niente: si cerca, come dice lui
  await aggiungi.fill("a");
  // le voci sono bottoni in un elenco, scelti col mouse premuto (onMouseDown,
  // per non perdere il fuoco del campo)
  const prima_voce = page.locator("ul li button").first();
  await expect(prima_voce).toBeVisible();
  await prima_voce.click();

  const celle = page.locator("input[data-riga][data-colonna]");
  await expect(celle.first()).toBeVisible();
  const prima = celle.first();

  // 1. selezionata: si scrive digitando, senza doppio clic
  await prima.focus();
  await page.keyboard.press("4");
  await expect(prima).toHaveValue("4");

  // 2. Esc rimette il valore di prima
  await page.keyboard.press("Escape");
  await expect(prima).not.toHaveValue("4");

  // 3. una freccia sposta il fuoco alla casella accanto
  const colonnaPrima = await prima.getAttribute("data-colonna");
  await page.keyboard.press("ArrowRight");
  const attiva = page.locator("input[data-riga][data-colonna]:focus");
  await expect(attiva).toHaveAttribute("data-colonna", String(Number(colonnaPrima) + 1));

  // 4. si scrive e si conferma con Invio: il valore resta salvato
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect(page.locator('input[data-colonna="1"]').first()).toHaveValue("3");

  // …e sopravvive a una ricarica: è finito sul server
  await page.reload();
  await expect(page.locator('input[data-colonna="1"]').first()).toHaveValue("3");
});
