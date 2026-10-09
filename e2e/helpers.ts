import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email = "admin@kancrm.local", password = "admin1234") {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("heading", { name: /^Ciao / })).toBeVisible();
  // Gli scenari simulano un admin che usa l'applicazione: dal 11/08/2026 i
  // privilegi si chiedono (stile sudo), quindi si prendono subito. Per chi
  // admin non è la chiamata risponde 403 e non cambia niente.
  await page.request.post("/api/auth/elevate").catch(() => undefined);
}
