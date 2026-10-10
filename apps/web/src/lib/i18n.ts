// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "@/locales";

/** Le lingue **concrete** supportate (l'enum `Locale` ha in più "auto"). */
export const LANGUAGES = ["it", "en", "fr", "de", "es", "pt"] as const;
type Language = (typeof LANGUAGES)[number];
const isSupported = (lang: string): lang is Language =>
  (LANGUAGES as readonly string[]).includes(lang);

const CACHE_KEY = "kancrm-lang";
/** Il default del prodotto quando nulla combacia: inglese. */
const DEFAULT_LANGUAGE = "en";

/** Locale BCP-47 per la formattazione (date, numeri, valuta) di ogni lingua. */
const BCP47: Record<string, string> = {
  it: "it-IT",
  en: "en-GB",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  pt: "pt-PT",
};

/** Il nome di ogni lingua nella lingua stessa (endonimo): è ciò che va nei
 *  selettori, così la si riconosce anche se l'interfaccia è in un'altra lingua. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  it: "Italiano",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
};

/** Il tag locale con cui `Intl` formatta date e numeri nella lingua attiva. */
export function localeTag(lang: string = i18n.language): string {
  return BCP47[lang] ?? BCP47[DEFAULT_LANGUAGE]!;
}

/**
 * La lingua quando l'utente non ne ha scelta una: l'ultima applicata (cache),
 * altrimenti quella del **browser** se la conosciamo, altrimenti **inglese**.
 */
export function detectLanguage(): string {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached && isSupported(cached)) return cached;
  const nav = (navigator.language || "").slice(0, 2);
  return isSupported(nav) ? nav : DEFAULT_LANGUAGE;
}

/** Risolve una preferenza (una lingua concreta, oppure "auto"/assente) in una
 *  lingua vera: "auto" e i valori sconosciuti diventano la lingua rilevata. */
export function resolveLanguage(pref: string | null | undefined): string {
  return pref && isSupported(pref) ? pref : detectLanguage();
}

/**
 * i18n con **l'italiano come chiave**.
 *
 * `t("Nuovo progetto")` ritorna l'italiano per default — il catalogo `it` è
 * vuoto, quindi i18next restituisce la chiave stessa — e la traduzione nelle
 * altre lingue. Così il sorgente resta leggibile (niente file di chiavi
 * astratte da tenere allineato) e una stringa non ancora tradotta ricade
 * automaticamente sull'italiano, non su una chiave nuda.
 *
 * Le stringhe **con plurale** non possono avere l'italiano come chiave (servono
 * due forme): stanno con le forme `_one`/`_other` in **ogni** catalogo, italiano
 * compreso, e si chiamano con `t("chiave", { count })`.
 */
void i18n.use(initReactI18next).init({
  resources: {
    it: { translation: catalogs.it },
    en: { translation: catalogs.en },
    fr: { translation: catalogs.fr },
    de: { translation: catalogs.de },
    es: { translation: catalogs.es },
    pt: { translation: catalogs.pt },
  },
  lng: detectLanguage(),
  fallbackLng: "it", // chiave = italiano: una stringa non tradotta resta italiana
  supportedLngs: [...LANGUAGES],
  // Le chiavi sono frasi italiane, con punti e due punti dentro: niente
  // separatori, o "Fatto." diventerebbe un percorso annidato.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React protegge già dall'XSS
  returnEmptyString: false,
});

// L'attributo <html lang> segue la lingua fin dal primo render (accessibilità,
// e la sillabazione del browser); poi `applyLanguage` lo tiene aggiornato.
document.documentElement.lang = i18n.language;

/**
 * Dove si ricorda che la lingua l'ha **scelta una persona**, adesso, sulla
 * schermata di accesso — non è la preferenza salvata sull'utente.
 *
 * Sta in `sessionStorage` e non in `localStorage` di proposito: vale per questa
 * sessione del browser e poi si dimentica. Chi entra da un computer altrui e
 * mette l'inglese per leggere la schermata non deve cambiare la propria lingua
 * per sempre; e chi la vuole cambiare davvero la cambia nel Profilo, che resta
 * l'unico posto che scrive la preferenza.
 */
const SCELTA_KEY = "kancrm-lang-scelta";

/** La lingua è stata scelta a mano in questa sessione? */
export function linguaSceltaAMano(): boolean {
  try {
    return sessionStorage.getItem(SCELTA_KEY) === "1";
  } catch {
    return false; // navigazione privata o storage negato: vale la preferenza
  }
}

/** Si dimentica la scelta: all'uscita, e quando il Profilo salva la sua. */
export function dimenticaLinguaScelta(): void {
  try {
    sessionStorage.removeItem(SCELTA_KEY);
  } catch {
    /* niente memoria: non c'era niente da dimenticare */
  }
}

/**
 * Applica e ricorda la lingua.
 *
 * `esplicita` distingue le due strade, che prima si confondevano: il selettore
 * della schermata di accesso è **una persona che sceglie**, e la sua scelta
 * deve valere anche dopo l'accesso — prima veniva sovrascritta un istante dopo
 * dalla preferenza salvata sull'utente, e chi aveva appena messo l'inglese si
 * ritrovava l'interfaccia in italiano senza capire perché. La preferenza
 * dell'utente, invece, non è esplicita: è il valore predefinito di chi entra.
 */
export function applyLanguage(
  lang: string | null | undefined,
  opzioni?: { esplicita?: boolean },
): void {
  const next = resolveLanguage(lang); // "auto"/assente → browser → inglese
  localStorage.setItem(CACHE_KEY, next);
  if (opzioni?.esplicita) {
    try {
      sessionStorage.setItem(SCELTA_KEY, "1");
    } catch {
      /* senza memoria la scelta vale finché non si ricarica: meglio di niente */
    }
  }
  document.documentElement.lang = next;
  if (i18n.language !== next) void i18n.changeLanguage(next);
}

export default i18n;
