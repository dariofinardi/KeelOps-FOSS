// Setup dei test frontend: matcher DOM di jest-dom + pulizia del DOM dopo ogni test.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";

// I test asseriscono sull'italiano, la lingua sorgente. In jsdom però
// navigator.language è "en-US", quindi i18n partirebbe in inglese; e chi cambia
// lingua (i test di i18n) lascerebbe il singleton globale su un'altra lingua.
// Si riporta a "it" prima di ogni test: deterministico e senza contaminazioni.
beforeEach(async () => {
  await i18n.changeLanguage("it");
});

afterEach(() => {
  cleanup();
});
