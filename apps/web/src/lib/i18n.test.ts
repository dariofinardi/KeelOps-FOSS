import { beforeAll, describe, expect, it } from "vitest";
import i18n, { localeTag } from "./i18n";

describe("i18n con l'italiano come chiave", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("it");
  });

  it("senza traduzione ritorna la frase italiana (la chiave stessa)", () => {
    expect(i18n.t("Una frase di prova mai tradotta")).toBe("Una frase di prova mai tradotta");
  });

  it("traduce quando la voce esiste", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("Accedi")).toBe("Sign in");
    await i18n.changeLanguage("fr");
    expect(i18n.t("Progetti")).toBe("Projets");
    await i18n.changeLanguage("es");
    expect(i18n.t("Esci")).toBe("Cerrar sesión");
  });

  it("una chiave assente in una lingua ricade sull'italiano, non su vuoto", async () => {
    await i18n.changeLanguage("de");
    expect(i18n.t("Frase presente solo in italiano")).toBe("Frase presente solo in italiano");
  });

  it("i plurali seguono la lingua tramite count", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("Hai {{count}} task aperti", { count: 1 })).toBe("You have 1 open task");
    expect(i18n.t("Hai {{count}} task aperti", { count: 3 })).toBe("You have 3 open tasks");
    await i18n.changeLanguage("it");
    expect(i18n.t("Hai {{count}} task aperti", { count: 1 })).toBe("Hai 1 task aperto");
    expect(i18n.t("Hai {{count}} task aperti", { count: 3 })).toBe("Hai 3 task aperti");
  });

  it("localeTag mappa la lingua sul tag Intl per date e numeri", () => {
    expect(localeTag("it")).toBe("it-IT");
    expect(localeTag("en")).toBe("en-GB");
    expect(localeTag("fr")).toBe("fr-FR");
    expect(localeTag("de")).toBe("de-DE");
    expect(localeTag("es")).toBe("es-ES");
    expect(localeTag("pt")).toBe("pt-PT");
  });
});
