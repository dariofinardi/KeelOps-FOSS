// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { copyNumber, nextCopyTitle, stripCopySuffix } from "../src/modules/tasks/duplicate";

/**
 * Il titolo di una copia. Il suffisso è tradotto — finisce in un campo che
 * resta scritto — e questo obbliga a **riconoscerlo in una lingua qualunque**:
 * la copia di ieri può averla fatta un collega con l'interfaccia in inglese.
 */
describe("il titolo di un task duplicato", () => {
  it("la prima copia porta il numero 1, nella lingua di chi duplica", () => {
    expect(nextCopyTitle("Verifica bilancio", [], "it")).toBe("Verifica bilancio (copia 1)");
    expect(nextCopyTitle("Verifica bilancio", [], "en")).toBe("Verifica bilancio (copy 1)");
    expect(nextCopyTitle("Verifica bilancio", [], "de")).toBe("Verifica bilancio (Kopie 1)");
  });

  it("duplicare una copia riparte dal titolo base, non impila i suffissi", () => {
    // Senza questo, la copia di una copia si chiamerebbe
    // "Verifica bilancio (copia 1) (copia 1)".
    expect(
      nextCopyTitle("Verifica bilancio (copia 1)", ["Verifica bilancio (copia 1)"], "it"),
    ).toBe("Verifica bilancio (copia 2)");
  });

  it("riconosce una copia fatta in un'altra lingua", () => {
    expect(stripCopySuffix("Verifica bilancio (copy 3)")).toBe("Verifica bilancio");
    expect(copyNumber("Verifica bilancio (Kopie 7)")).toBe(7);
    expect(nextCopyTitle("Verifica bilancio", ["Verifica bilancio (copy 3)"], "it")).toBe(
      "Verifica bilancio (copia 4)",
    );
  });

  it("il numero è il primo dopo il più alto, non il conteggio delle copie", () => {
    // Cancellata la (copia 2), la prossima è la 4: riusare il 3 vorrebbe dire
    // dare a due task un nome che qualcuno ha ancora sotto gli occhi.
    const esistenti = ["Verifica bilancio (copia 1)", "Verifica bilancio (copia 3)"];
    expect(nextCopyTitle("Verifica bilancio", esistenti, "it")).toBe("Verifica bilancio (copia 4)");
  });

  it("i titoli di altri task non entrano nel conto", () => {
    const esistenti = ["Verifica cassa (copia 9)", "Verifica bilancio annuale (copia 5)"];
    expect(nextCopyTitle("Verifica bilancio", esistenti, "it")).toBe("Verifica bilancio (copia 1)");
  });

  it("un titolo lunghissimo perde la coda, non il numero", () => {
    // Tagliare il suffisso renderebbe due copie indistinguibili, che è
    // esattamente il problema che il numero risolve.
    const lungo = "a".repeat(250);
    const titolo = nextCopyTitle(lungo, [], "it");
    expect(titolo.length).toBeLessThanOrEqual(200);
    expect(titolo.endsWith("(copia 1)")).toBe(true);
  });

  it("un titolo che finisce per caso con qualcosa di simile non è una copia", () => {
    expect(stripCopySuffix("Rivedere la copia del contratto")).toBe(
      "Rivedere la copia del contratto",
    );
    expect(copyNumber("Fattura 2026")).toBeNull();
  });
});
