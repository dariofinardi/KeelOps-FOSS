import path from "node:path";
import os from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leggiVoceUi } from "../src/plugins/plugin-host";

/**
 * **L'icona propria del plugin.** `ui.icona: "icona.svg"` indica un file nella
 * cartella statica: se c'è, la voce porta l'indirizzo da cui il browser la
 * prende; se manca, o il nome tenta di uscire dalla cartella, si ripiega sul
 * puzzle con un avviso. Un nome senza estensione resta un'icona del set.
 */
describe("l'icona del plugin", () => {
  const cartella = path.join(os.tmpdir(), `keelops-icona-${process.pid}`);
  beforeAll(() => {
    mkdirSync(cartella, { recursive: true });
    writeFileSync(path.join(cartella, "icona.svg"), "<svg/>");
  });
  afterAll(() => rmSync(cartella, { recursive: true, force: true }));
  const base = { nome: "eco", versione: "0.0.1", titolo: "Eco" };

  it("un file che esiste diventa un indirizzo sotto /plugins/<nome>/", () => {
    const avvisi: string[] = [];
    const voce = leggiVoceUi(
      "eco",
      { ...base, ui: { icona: "icona.svg" } },
      (m: string) => avvisi.push(m),
      cartella,
    );
    expect(voce.iconaUrl).toBe("/plugins/eco/icona.svg");
    expect(voce.icona).toBe("icona.svg");
    expect(avvisi).toEqual([]);
  });

  it("un file che manca ripiega sul puzzle, e lo dice", () => {
    const avvisi: string[] = [];
    const voce = leggiVoceUi(
      "eco",
      { ...base, ui: { icona: "altra.svg" } },
      (m: string) => avvisi.push(m),
      cartella,
    );
    expect(voce.iconaUrl).toBeNull();
    expect(voce.icona).toBe("puzzle");
    expect(avvisi[0]).toMatch(/altra\.svg/);
  });

  it("un percorso che risale la cartella non passa", () => {
    const avvisi: string[] = [];
    const voce = leggiVoceUi(
      "eco",
      { ...base, ui: { icona: "../icona.svg" } },
      (m: string) => avvisi.push(m),
      cartella,
    );
    expect(voce.iconaUrl).toBeNull();
    expect(voce.icona).toBe("puzzle");
    expect(avvisi).toHaveLength(1);
  });

  it("un nome del set resta com'è, anche senza cartella statica", () => {
    const voce = leggiVoceUi("eco", { ...base, ui: { icona: "columns-3" } }, () => undefined);
    expect(voce).toMatchObject({ icona: "columns-3", iconaUrl: null });
  });
});
