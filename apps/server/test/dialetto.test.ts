import { describe, expect, it } from "vitest";
import {
  colonneTestualiSql,
  dimensioneDatabaseSql,
  doveViveIlDatabase,
  giorniFa,
  ident,
  versioneMotore,
} from "../src/lib/dialetto";
import { databasePath } from "../src/db";

/**
 * I test girano su SQLite, che è la produzione di oggi: qui si controlla che
 * l'angolo del dialetto dica le cose giuste per **questo** motore, e che citi
 * gli identificatori senza lasciare buchi.
 */
describe("l'angolo del dialetto (su SQLite)", () => {
  it("cita i nomi con le virgolette doppie, raddoppiando quelle interne", () => {
    expect(ident("Task")).toBe('"Task"');
    expect(ident('str"ano')).toBe('"str""ano"');
  });

  it("l'istante di N giorni fa è l'espressione di SQLite", () => {
    expect(giorniFa(90)).toBe("datetime('now', '-90 day')");
  });

  it("rifiuta un numero di giorni che non è tale: finirebbe dentro l'SQL", () => {
    expect(() => giorniFa(Number.NaN)).toThrow();
    expect(() => giorniFa(-1)).toThrow();
    // niente decimali dentro la stringa
    expect(giorniFa(7.9)).toBe("datetime('now', '-7 day')");
  });

  it("la versione del motore si chiede come sa SQLite", () => {
    expect(versioneMotore()).toEqual({
      sql: "SELECT sqlite_version() AS version",
      etichetta: "SQLite",
    });
  });

  it("le colonne di testo su SQLite si leggono dai PRAGMA, non da una query sola", () => {
    expect(colonneTestualiSql()).toBeNull();
  });

  it("dove vive il database, su SQLite, è il file", () => {
    expect(doveViveIlDatabase()).toBe(databasePath);
  });

  it("la dimensione su SQLite non si chiede al motore: la dice il file", () => {
    expect(dimensioneDatabaseSql()).toBeNull();
  });
});
