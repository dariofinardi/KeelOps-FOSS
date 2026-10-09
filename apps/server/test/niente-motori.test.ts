/**
 * **Un gestionale non si indicizza.**
 *
 * Il 09/09/2026 la schermata di accesso della produzione è comparsa su Google
 * al posto del sito del prodotto. Comparire non è solo sbagliato di immagine:
 * vuol dire pubblicare l'indirizzo da cui si prova a entrare.
 *
 * Questi test guardano soprattutto **che il divieto ci sia dove serve** — su
 * ogni risposta, non solo sull'HTML — e che `robots.txt` **non** vieti la
 * scansione: è la parte contro-intuitiva, e quella che qualcuno prima o poi
 * "correggerà" senza sapere perché era così.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "./support/test-db";

prepareTestDb("niente-motori");

const { buildApp } = await import("../src/app");

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

describe("niente motori di ricerca", () => {
  it("ogni risposta porta il divieto, anche senza sessione", async () => {
    const risposta = await app.inject({ method: "GET", url: "/api/health" });
    expect(risposta.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("anche un rifiuto lo porta: un 401 è comunque un indirizzo che esiste", async () => {
    const risposta = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(risposta.statusCode).toBe(401);
    expect(risposta.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("e anche quello che non esiste", async () => {
    const risposta = await app.inject({ method: "GET", url: "/api/questa-non-ce" });
    expect(risposta.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("robots.txt si legge senza sessione: deve poterlo leggere un motore", async () => {
    const risposta = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(risposta.statusCode).toBe(200);
    expect(risposta.headers["content-type"]).toContain("text/plain");
  });

  it("robots.txt NON vieta la scansione, ed è voluto", async () => {
    // Vietarla congelerebbe l'indicizzazione invece di toglierla: un motore
    // che non può leggere la pagina non legge nemmeno il «noindex».
    const testo = (await app.inject({ method: "GET", url: "/robots.txt" })).body;
    expect(testo).toContain("User-agent: *");
    expect(testo).toMatch(/^Disallow:\s*$/m);
    expect(testo, "un «Disallow: /» qui rimetterebbe il problema").not.toMatch(/^Disallow: \/\s*$/m);
  });
});

/**
 * **Gli script dell'SDK arrivano come file, non inline.**
 *
 * È la stessa storia dei motori di ricerca: una regola che vale solo in
 * produzione, e che in sviluppo non si vede. La CSP di produzione è
 * `script-src 'self'`, quindi un `<script>` col codice dentro non viene
 * eseguito: il tema del plugin non segue quello del guscio e il riquadro
 * resta dell'altezza sbagliata, in silenzio. Il guscio serve `sdk/tema.js` e
 * `sdk/riquadro.js` per ogni plugin, così nessuno deve ricordarsene.
 */
describe("gli script del browser dell'SDK", () => {
  /**
   * L'SDK si carica per indirizzo, come fa il guscio (`plugin-host.ts`): è
   * JavaScript fuori dal progetto TypeScript, e importarlo per percorso
   * vorrebbe dire chiedere a `tsc` di tiparlo.
   */
  const caricaSdk = async () =>
    (await import(
      pathToFileURL(path.resolve(import.meta.dirname, "../../../plugins/keelops-sdk/ui.mjs")).href
    )) as unknown as { TEMA_SCRIPT: string; FRAME_RESIZE_SCRIPT: string; avviaRiquadro: () => void };

  it("`sdk/tema.js` e `sdk/riquadro.js` esistono e sono JavaScript", async () => {
    const ui = await caricaSdk();
    expect(ui.TEMA_SCRIPT.length).toBeGreaterThan(50);
    expect(ui.FRAME_RESIZE_SCRIPT).toContain("postMessage");
  });

  it("la stringa del riquadro è DERIVATA dalla funzione, non una seconda copia", async () => {
    const ui = await caricaSdk();
    expect(ui.FRAME_RESIZE_SCRIPT).toContain(ui.avviaRiquadro.toString());
  });
});
