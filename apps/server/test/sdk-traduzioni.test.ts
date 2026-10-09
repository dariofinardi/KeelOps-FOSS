import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Le traduzioni delle pagine dei plugin** (22/09/2026): un meccanismo solo,
 * nell'SDK, servito come `sdk/traduzioni.js`. Prima era copiato in Presenze e
 * TasksMap, già diverso fra i due. Qui si prova lo script **come lo riceve il
 * browser** — il testo, eseguito su una finestra finta — non la funzione.
 */
const sdkUi = (await import(
  pathToFileURL(path.resolve(import.meta.dirname, "../../../plugins/keelops-sdk/ui.mjs")).href
)) as { TRADUZIONI_SCRIPT: string };

interface Elemento {
  attributi: Record<string, string>;
  textContent: string;
  getAttribute(nome: string): string | null;
  setAttribute(nome: string, valore: string): void;
}
const elemento = (attributi: Record<string, string>): Elemento => ({
  attributi,
  textContent: "",
  getAttribute(nome) {
    return this.attributi[nome] ?? null;
  },
  setAttribute(nome, valore) {
    this.attributi[nome] = valore;
  },
});

function pagina(linguaBrowser: string, elementi: Elemento[] = []) {
  const documentElement = { lang: "" };
  const document = {
    readyState: "complete",
    documentElement,
    title: "",
    querySelectorAll: (selettore: string) => {
      const attributo = selettore.slice(1, -1);
      return elementi.filter((e) => attributo in e.attributi);
    },
    addEventListener: () => undefined,
  };
  const window: Record<string, unknown> = {};
  const esegui = new Function("window", "document", "navigator", sdkUi.TRADUZIONI_SCRIPT);
  esegui(window, document, { language: linguaBrowser });
  return { window, document };
}

type I18n = {
  crea: (
    c: Record<string, Record<string, string>>,
    o?: { titolo?: string },
  ) => { t: (k: string, v?: Record<string, unknown>) => string; imposta: (l: string) => void; lingua: () => string };
};

describe("sdk/traduzioni.js", () => {
  const cataloghi = {
    en: { Lotti: "Batches", "{n} misure": "{n} measurements", "Solo inglese": "English only" },
    fr: { Lotti: "Lots" },
  };

  it("l'italiano è la chiave, e con un browser italiano torna com'è", () => {
    const { window } = pagina("it-IT");
    const i18n = (window.KeelOpsI18n as I18n).crea(cataloghi);
    expect(i18n.t("Lotti")).toBe("Lotti");
    expect(i18n.t("{n} misure", { n: 3 })).toBe("3 misure");
  });

  it("la lingua della persona vince su quella del browser", () => {
    const { window } = pagina("it-IT");
    const i18n = (window.KeelOpsI18n as I18n).crea(cataloghi);
    i18n.imposta("en");
    expect(i18n.lingua()).toBe("en");
    expect(i18n.t("{n} misure", { n: 3 })).toBe("3 measurements");
  });

  it("una lingua senza la frase ricade sull'inglese, e poi sull'italiano", () => {
    const { window } = pagina("fr-FR");
    const i18n = (window.KeelOpsI18n as I18n).crea(cataloghi);
    expect(i18n.t("Lotti")).toBe("Lots");
    expect(i18n.t("Solo inglese")).toBe("English only");
    expect(i18n.t("Mai tradotta")).toBe("Mai tradotta");
  });

  it("una lingua che il prodotto non ha resta italiana", () => {
    const { window } = pagina("ja-JP");
    const i18n = (window.KeelOpsI18n as I18n).crea(cataloghi);
    expect(i18n.lingua()).toBe("it");
    i18n.imposta("xx");
    expect(i18n.lingua()).toBe("it");
  });

  it("le etichette statiche si traducono da sole, titoli con aria-label", () => {
    const etichetta = elemento({ "data-i18n": "Lotti" });
    const campo = elemento({ "data-i18n-placeholder": "Lotti" });
    const bottone = elemento({ "data-i18n-title": "Lotti" });
    const { window, document } = pagina("en-GB", [etichetta, campo, bottone]);
    (window.KeelOpsI18n as I18n).crea(cataloghi, { titolo: "Lotti" });
    expect(etichetta.textContent).toBe("Batches");
    expect(campo.attributi.placeholder).toBe("Batches");
    expect(bottone.attributi["aria-label"]).toBe("Batches");
    expect(document.title).toBe("Batches");
    expect(document.documentElement.lang).toBe("en");
  });
});
