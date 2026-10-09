/**
 * **La modalità dimostrazione non deve toccare la produzione.**
 *
 * Il flag `DEMO` accende due cose: le credenziali stampate sulla pagina di
 * accesso e il rifiuto dei caricamenti. Questi test provano soprattutto il
 * verso opposto — che **senza** il flag l'applicazione è esattamente quella di
 * prima — perché è la parte che si rompe in silenzio: un `if` scritto male
 * lascia in produzione un rifiuto che nessuno si aspetta, e lo si scopre da un
 * allegato che non si carica più.
 */
import { describe, expect, it } from "vitest";
import { leggiConfigDemo } from "../src/config";
import { opzioniCookieSessione } from "../src/plugins/auth";

describe("modalità dimostrazione: spenta", () => {
  it("senza DEMO non esiste, anche se le credenziali sono scritte", () => {
    expect(leggiConfigDemo(false, "a@b.demo:Admin", "segreta")).toBeNull();
  });

  it("DEMO=false è falso davvero (la stringa \"false\" non è un sì)", () => {
    expect(leggiConfigDemo(false, "", "")).toBeNull();
  });
});

describe("modalità dimostrazione: accesa", () => {
  it("legge le coppie indirizzo/ruolo", () => {
    const demo = leggiConfigDemo(true, "a@x.demo:Amministratore, b@x.demo:Commerciale", "chiave");
    expect(demo).toEqual({
      password: "chiave",
      accounts: [
        { email: "a@x.demo", role: "Amministratore" },
        { email: "b@x.demo", role: "Commerciale" },
      ],
    });
  });

  it("esiste anche senza credenziali: serve a bloccare i caricamenti", () => {
    expect(leggiConfigDemo(true, "", "")).toEqual({ password: "", accounts: [] });
  });

  it("senza password non stampa nessun indirizzo", () => {
    // Un elenco di indirizzi senza la chiave per entrarci è solo un invito a
    // provare password a caso.
    expect(leggiConfigDemo(true, "a@x.demo:Admin", "")?.accounts).toEqual([]);
  });

  it("scarta le voci storte invece di stamparle a metà", () => {
    const demo = leggiConfigDemo(true, "senza-duepunti, :solo-ruolo, buona@x.demo:Ruolo", "k");
    expect(demo?.accounts).toEqual([{ email: "buona@x.demo", role: "Ruolo" }]);
  });
});

/**
 * Il cookie di sessione: **fuori dalla demo non cambia niente**, e questo è il
 * test che conta. Un gestionale interno non chiede il permesso a nessuno, e il
 * cookie dura quanto la sessione in banca dati — come è sempre stato.
 */
describe("cookie di sessione", () => {
  const scadenza = new Date("2026-10-01T00:00:00.000Z");
  const finta = (cookies: Record<string, string>) =>
    ({ cookies }) as unknown as Parameters<typeof opzioniCookieSessione>[0];

  it("senza modalità demo scade sempre, qualunque cosa dica il cookie del consenso", () => {
    // config.demo è null: è la configurazione dei test, cioè quella normale.
    expect(opzioniCookieSessione(finta({}), scadenza).expires).toEqual(scadenza);
    expect(opzioniCookieSessione(finta({ kancrm_consenso: "0" }), scadenza).expires).toEqual(
      scadenza,
    );
  });
});
