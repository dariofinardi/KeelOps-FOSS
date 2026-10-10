// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **La lingua scelta a mano vince sulla preferenza salvata.**
 *
 * Chi sceglie l'inglese sulla schermata di accesso e poi entra con un utente
 * impostato in italiano deve trovare l'inglese: prima la preferenza dell'utente
 * si applicava un istante dopo l'accesso e cancellava la scelta appena fatta,
 * senza che niente lo spiegasse.
 *
 * La scelta sta in `sessionStorage`, quindi vale per questa finestra e poi si
 * dimentica: chi entra da un computer altrui non cambia la propria lingua per
 * sempre, e il prossimo che accede da quel browser trova la sua.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyLanguage, dimenticaLinguaScelta, linguaSceltaAMano } from "./i18n";

describe("la lingua scelta a mano", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("non risulta scelta se nessuno l'ha scelta", () => {
    expect(linguaSceltaAMano()).toBe(false);
  });

  it("applicare la preferenza dell'utente NON è una scelta a mano", () => {
    // È la strada di App.tsx quando legge `user.locale`: non deve mettere il
    // segno, o si autoconfermerebbe e la regola non varrebbe più niente.
    applyLanguage("it");
    expect(linguaSceltaAMano()).toBe(false);
  });

  it("il selettore dell'accesso invece sì", () => {
    applyLanguage("en", { esplicita: true });
    expect(linguaSceltaAMano()).toBe(true);
  });

  it("uscendo si dimentica", () => {
    applyLanguage("en", { esplicita: true });
    dimenticaLinguaScelta();
    expect(linguaSceltaAMano()).toBe(false);
  });

  it("la lingua applicata resta ricordata anche dopo aver dimenticato la scelta", () => {
    // Sono due cose diverse: quale lingua (localStorage, per non lampeggiare)
    // e chi l'ha decisa (sessionStorage).
    applyLanguage("de", { esplicita: true });
    dimenticaLinguaScelta();
    expect(localStorage.getItem("kancrm-lang")).toBe("de");
  });
});
