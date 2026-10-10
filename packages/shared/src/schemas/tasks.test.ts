// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { codeLanguage, viewableKind } from "./tasks";

/**
 * Cosa si legge nel lettore interno. La regola che merita i test è la
 * **precedenza**: un `.json` è codice E testo, un `.md` è testo E markdown —
 * l'ordine dei rami decide cosa vede l'utente, e invertirlo non dà errori.
 */
describe("viewableKind: i formati testuali", () => {
  it("il foglio di calcolo moderno si legge; il vecchio .xls no", () => {
    expect(viewableKind(null, "Articoli.xlsx")).toBe("sheet");
    expect(
      viewableKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x"),
    ).toBe("sheet");
    // Il binario vecchio vorrebbe un secondo lettore per pochi file.
    expect(viewableKind(null, "vecchio.xls")).toBeNull();
  });

  it("markdown e testo semplice", () => {
    expect(viewableKind(null, "README.md")).toBe("markdown");
    expect(viewableKind(null, "note.markdown")).toBe("markdown");
    expect(viewableKind(null, "log.txt")).toBe("text");
    expect(viewableKind("text/plain", "senza-estensione")).toBe("text");
    expect(viewableKind(null, "dati.csv")).toBe("text");
  });

  it("il codice vince sul testo: un .json colorato si legge meglio", () => {
    expect(viewableKind("text/plain", "config.json")).toBe("code");
    expect(viewableKind(null, "script.py")).toBe("code");
    expect(viewableKind(null, "Componente.tsx")).toBe("code");
  });

  it("i formati di prima non cambiano posto", () => {
    expect(viewableKind("application/pdf", "doc.pdf")).toBe("pdf");
    expect(viewableKind(null, "relazione.docx")).toBe("docx");
    expect(viewableKind(null, "clip.mp4")).toBe("video");
    expect(viewableKind(null, "voce.mp3")).toBe("audio");
    expect(viewableKind(null, "schema.png")).toBe("image");
    expect(viewableKind(null, "archivio.zip")).toBeNull();
  });
});

describe("codeLanguage: dall'estensione, senza indovinare", () => {
  it("le estensioni note", () => {
    expect(codeLanguage("server.ts")).toBe("typescript");
    expect(codeLanguage("app.PY")).toBe("python");
    expect(codeLanguage("query.sql")).toBe("sql");
    expect(codeLanguage("stile.scss")).toBe("scss");
    expect(codeLanguage("patch.diff")).toBe("diff");
  });

  it("i file che sono il proprio nome", () => {
    expect(codeLanguage("Dockerfile")).toBe("dockerfile");
    expect(codeLanguage("Makefile")).toBe("makefile");
  });

  it("l'ignoto non è un errore: si mostra senza colori", () => {
    expect(codeLanguage("appunti.xyz")).toBeNull();
    expect(codeLanguage("senza-estensione")).toBeNull();
  });
});
