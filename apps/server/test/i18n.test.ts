// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { serverT, resolveServerLocale, localeOfUser } from "../src/i18n";

describe("i18n del server (messaggi all'utente)", () => {
  it("l'italiano è la chiave: senza traduzione torna la frase italiana", () => {
    expect(serverT("it", "Task non trovato")).toBe("Task non trovato");
    expect(serverT("it", "Una frase mai tradotta")).toBe("Una frase mai tradotta");
  });

  it("traduce un messaggio d'errore nella lingua data", () => {
    expect(serverT("en", "Task non trovato")).toBe("Task not found");
    expect(serverT("fr", "Credenziali non valide")).toBe("Identifiants invalides");
    expect(serverT("de", "Operazione non consentita")).toBe("Vorgang nicht erlaubt");
  });

  it("una chiave non tradotta ricade sull'italiano, non su vuoto", () => {
    expect(serverT("en", "Frase presente solo in italiano")).toBe(
      "Frase presente solo in italiano",
    );
  });

  it("interpola i segnaposto {{var}}", () => {
    expect(serverT("en", "Valore già esistente: {{field}}", { field: "email" })).toBe(
      "Value already exists: email",
    );
  });

  it("gli errori con valori variabili si traducono e interpolano", () => {
    // Dato che passa invariato (il nome dello stato è un dato, non una chiave).
    expect(
      serverT("en", 'Lo stato "{{status}}" appartiene a un\'altra categoria di attività', {
        status: "In esecuzione",
      }),
    ).toBe('Status "In esecuzione" belongs to another activity category');
    expect(
      serverT("de", "Il mese {{month}} è chiuso: le ore non sono più modificabili", {
        month: "2026-08",
      }),
    ).toBe("Der Monat 2026-08 ist abgeschlossen: die Stunden sind nicht mehr änderbar");
  });

  it("gli errori con un conteggio scelgono la forma plurale per lingua", () => {
    const key = "Ha {{count}} subtask: la gerarchia esiste solo dentro un progetto";
    expect(serverT("en", key, { count: 1 })).toBe(
      "It has 1 subtask: the hierarchy only exists inside a project",
    );
    expect(serverT("en", key, { count: 3 })).toBe(
      "It has 3 subtasks: the hierarchy only exists inside a project",
    );
    expect(serverT("it", key, { count: 1 })).toBe(
      "Ha 1 subtask: la gerarchia esiste solo dentro un progetto",
    );
  });

  it("'auto' e le lingue sconosciute diventano inglese (default del prodotto)", () => {
    expect(resolveServerLocale("auto")).toBe("en");
    expect(resolveServerLocale(null)).toBe("en");
    expect(resolveServerLocale("xx")).toBe("en");
    expect(resolveServerLocale("fr")).toBe("fr");
    expect(localeOfUser({ locale: "auto" })).toBe("en");
    expect(localeOfUser({ locale: "de" })).toBe("de");
  });
});
