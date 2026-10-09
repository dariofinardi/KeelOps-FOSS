import path from "node:path";
import { defineConfig } from "@playwright/test";

const E2E_DATA = path.resolve(import.meta.dirname, "e2e", ".data");
const E2E_PORT = 3101;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
    /**
     * Il browser di prova parla italiano.
     *
     * Gli scenari cercano le etichette per come le legge l'utente ("Accedi",
     * "Menu"), e prima dell'accesso la lingua la decide il **browser** (la
     * preferenza salvata si applica solo dopo): con il locale di partenza di
     * Playwright (en-US) l'applicazione si presentava in inglese e ogni
     * scenario si fermava sul pulsante di accesso.
     */
    locale: "it-IT",
  },
  webServer: {
    // Prepara il db dedicato (migrazioni+seed) e serve API + build statica.
    command: "node e2e/setup-db.mjs && pnpm --filter @kancrm/server exec tsx src/index.ts",
    url: `http://localhost:${E2E_PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(E2E_PORT),
      DATABASE_PATH: path.join(E2E_DATA, "app.db"),
      UPLOADS_DIR: path.join(E2E_DATA, "uploads"),
      BACKUPS_DIR: path.join(E2E_DATA, "backups"),
      LOG_DIR: path.join(E2E_DATA, "logs"),
      // L'anti-forza-bruta è una difesa di produzione, non una regola del
      // banco di prova: dieci accessi per indirizzo IP li consuma la suite
      // stessa (ogni scenario entra), e gli ultimi fallivano sulla pagina di
      // accesso invece che su quello che dovevano provare.
      LOGIN_RATE_LIMIT_MAX: "1000",
      // I plugin «Personale» e «TasksMap» fanno parte della prova: la pagina di Personale (ui/dist) va
      // costruita prima, come la build del core — `pnpm build` fa entrambe.
      PLUGINS: "Personale,TasksMap",
    },
  },
});
