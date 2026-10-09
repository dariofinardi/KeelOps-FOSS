import { describe, expect, it } from "vitest";
import { intentOf } from "./grid-keys";

const selezionata = (key: string, extra: Record<string, boolean> = {}) =>
  intentOf({ key, ...extra }, false);
const inScrittura = (key: string, extra: Record<string, boolean> = {}) =>
  intentOf({ key, ...extra }, true);

describe("tastiera della griglia: casella selezionata", () => {
  it("le frecce spostano di una casella", () => {
    expect(selezionata("ArrowUp")).toEqual({ kind: "move", dr: -1, dc: 0 });
    expect(selezionata("ArrowDown")).toEqual({ kind: "move", dr: 1, dc: 0 });
    expect(selezionata("ArrowLeft")).toEqual({ kind: "move", dr: 0, dc: -1 });
    expect(selezionata("ArrowRight")).toEqual({ kind: "move", dr: 0, dc: 1 });
  });

  it("Tab va a destra, Shift+Tab a sinistra", () => {
    expect(selezionata("Tab")).toEqual({ kind: "move", dr: 0, dc: 1 });
    expect(selezionata("Tab", { shiftKey: true })).toEqual({ kind: "move", dr: 0, dc: -1 });
  });

  it("Home e Fine portano ai bordi della riga", () => {
    expect(selezionata("Home")).toEqual({ kind: "edge", to: "start" });
    expect(selezionata("End")).toEqual({ kind: "edge", to: "end" });
  });

  it("digitare una cifra entra in scrittura, con dentro quello che si è digitato", () => {
    expect(selezionata("4")).toEqual({ kind: "edit", char: "4" });
    expect(selezionata("0")).toEqual({ kind: "edit", char: "0" });
    // i due separatori decimali che la gente usa davvero
    expect(selezionata(",")).toEqual({ kind: "edit", char: "," });
    expect(selezionata(".")).toEqual({ kind: "edit", char: "." });
  });

  it("le lettere non aprono la scrittura: nelle ore non ci vanno", () => {
    expect(selezionata("a")).toBeNull();
    expect(selezionata("-")).toBeNull();
  });

  it("Invio e F2 aprono la scrittura senza scrivere niente", () => {
    expect(selezionata("Enter")).toEqual({ kind: "edit" });
    expect(selezionata("F2")).toEqual({ kind: "edit" });
  });

  it("Canc e Backspace svuotano la casella", () => {
    expect(selezionata("Delete")).toEqual({ kind: "clear" });
    expect(selezionata("Backspace")).toEqual({ kind: "clear" });
  });
});

describe("tastiera della griglia: casella in scrittura", () => {
  it("Invio conferma e scende, Shift+Invio conferma e sale", () => {
    expect(inScrittura("Enter")).toEqual({ kind: "commit", dr: 1, dc: 0 });
    expect(inScrittura("Enter", { shiftKey: true })).toEqual({ kind: "commit", dr: -1, dc: 0 });
  });

  it("Tab conferma e va di lato", () => {
    expect(inScrittura("Tab")).toEqual({ kind: "commit", dr: 0, dc: 1 });
    expect(inScrittura("Tab", { shiftKey: true })).toEqual({ kind: "commit", dr: 0, dc: -1 });
  });

  it("su e giù confermano e spostano", () => {
    expect(inScrittura("ArrowUp")).toEqual({ kind: "commit", dr: -1, dc: 0 });
    expect(inScrittura("ArrowDown")).toEqual({ kind: "commit", dr: 1, dc: 0 });
  });

  it("sinistra e destra muovono il cursore nel testo, non la casella", () => {
    // scrivendo "4,5" servono a correggere: se spostassero, non si potrebbe
    expect(inScrittura("ArrowLeft")).toBeNull();
    expect(inScrittura("ArrowRight")).toBeNull();
  });

  it("Esc annulla e riporta il valore di prima", () => {
    expect(inScrittura("Escape")).toEqual({ kind: "cancel" });
  });

  it("le cifre le scrive il campo: qui non c'è nessuna intenzione", () => {
    expect(inScrittura("4")).toBeNull();
    expect(inScrittura("Backspace")).toBeNull();
  });
});

describe("le scorciatoie di sistema restano di sistema", () => {
  it("con Ctrl, Cmd o Alt la griglia non interviene", () => {
    for (const modificatore of ["ctrlKey", "metaKey", "altKey"]) {
      expect(selezionata("ArrowDown", { [modificatore]: true })).toBeNull();
      expect(inScrittura("Enter", { [modificatore]: true })).toBeNull();
      // Ctrl+C su una casella selezionata deve copiare, non scrivere "c"
      expect(selezionata("4", { [modificatore]: true })).toBeNull();
    }
  });
});
