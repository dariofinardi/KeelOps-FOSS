import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./task-utils";

/**
 * Le due funzioni che trasformano un dato del server in qualcosa da leggere.
 *
 * Meritano un test perché hanno già portato giù una pagina: la colonna "Creato"
 * passava a `formatDate` un **istante** invece di una data, `Intl` ha risposto
 * lanciando un errore, e l'intera vista Bacheche è diventata una schermata
 * bianca (14/08/2026). Nei DTO le due forme convivono — le scadenze sono date,
 * la creazione è un istante — quindi le funzioni le accettano entrambe, e
 * qualunque cosa non sappiano leggere diventa un trattino.
 */
describe("date leggibili", () => {
  it("una data pura non slitta di un giorno", () => {
    expect(formatDate("2026-08-14")).toBe("14/08/2026");
    // Il primo dell'anno è il caso in cui uno slittamento si vede subito.
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("accetta anche un istante ISO, come arriva da createdAt", () => {
    expect(formatDate("2026-08-14T09:12:33.000Z")).toBe("14/08/2026");
    // Mezzanotte e mezza a Roma è ancora il giorno prima in UTC: conta il fuso
    // aziendale, non la stringa.
    expect(formatDate("2026-08-13T22:30:00.000Z")).toBe("14/08/2026");
  });

  it("quello che non si sa leggere è un trattino, non un errore", () => {
    expect(formatDate("")).toBe("—");
    expect(formatDate("non è una data")).toBe("—");
    expect(formatDateTime("2026-99-99T99:99:99Z")).toBe("—");
  });

  it("con l'orario si legge giorno e ora, nel fuso aziendale", () => {
    // 09:12 UTC d'estate a Roma sono le 11:12.
    expect(formatDateTime("2026-08-14T09:12:00.000Z")).toContain("14/08/2026");
    expect(formatDateTime("2026-08-14T09:12:00.000Z")).toContain("11:12");
  });
});
