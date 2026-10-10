// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  TICKET_ATTACHMENT_ACCEPT,
  TICKET_ATTACHMENT_LABEL,
  attachmentLabel,
  firstRejectedAttachment,
  isAllowedTicketAttachment,
  parseExtraExtensions,
} from "./ticket-attachments";

describe("allegati ammessi in una richiesta di supporto", () => {
  it("passano PDF, ZIP, Word e immagini, comunque scritta l'estensione", () => {
    for (const name of [
      "contratto.pdf",
      "LOG.ZIP",
      "verbale.docx",
      "vecchio.doc",
      // Excel dal portale clienti (14/09/2026): il foglio con i dati che
      // riproducono il difetto.
      "dati.xlsx",
      "storico.XLS",
      "schermata.PNG",
      "foto.jpeg",
      "animazione.gif",
      "screenshot.webp",
      "scatto.heic",
      // Testo semplice (19/09/2026): il log dell'app dal Microsoft Store.
      "appunti.txt",
      "edito-2026-09-19.LOG",
    ]) {
      expect(isAllowedTicketAttachment(name), name).toBe(true);
    }
  });

  it("restano fuori eseguibili, script e file senza estensione", () => {
    for (const name of ["setup.exe", "macro.docm", "script.sh", "note", "pagina.html"]) {
      expect(isAllowedTicketAttachment(name), name).toBe(false);
    }
  });

  it("l'SVG non passa: è un documento con dentro degli script, e si apre inline", () => {
    expect(isAllowedTicketAttachment("logo.svg")).toBe(false);
  });

  it("un punto nel nome non è un'estensione", () => {
    // "relazione.finale" non ha estensione ammessa; ".pdf" nascosto in mezzo sì.
    expect(isAllowedTicketAttachment("relazione.finale")).toBe(false);
    expect(isAllowedTicketAttachment("relazione.finale.pdf")).toBe(true);
  });

  it("dice QUALE file è di troppo, non che 'qualcosa' non va", () => {
    expect(firstRejectedAttachment(["a.pdf", "b.png"])).toBeNull();
    expect(firstRejectedAttachment(["a.pdf", "virus.exe", "c.zip"])).toBe("virus.exe");
  });

  it("l'attributo accept elenca le stesse estensioni della regola", () => {
    // Se domani se ne aggiunge una alla lista, il selettore la offre da sé.
    for (const ext of TICKET_ATTACHMENT_ACCEPT.split(",")) {
      expect(isAllowedTicketAttachment(`file${ext}`), ext).toBe(true);
    }
  });
});

/**
 * Le estensioni si configurano dalla pagina Sistema e le scrive una persona:
 * col punto o senza, in maiuscolo, separate da virgole o da spazi. Se la
 * normalizzazione non regge, un cliente si vede rifiutare un `.padmu` che
 * l'amministratore crede di aver ammesso.
 */
describe("le estensioni configurate in più", () => {
  it("accetta come le scrive una persona", () => {
    expect(parseExtraExtensions("padmu, .PADMU2  ;dwg")).toEqual([".padmu", ".padmu2", ".dwg"]);
  });

  it("scarta quello che non è un'estensione, invece di fidarsi", () => {
    expect(parseExtraExtensions(".exe/../../etc")).toEqual([]);
    expect(parseExtraExtensions("")).toEqual([]);
    expect(parseExtraExtensions(null)).toEqual([]);
    expect(parseExtraExtensions(".")).toEqual([]);
  });

  it("i documenti dei nostri prodotti valgono comunque, anche senza configurazione", () => {
    expect(isAllowedTicketAttachment("voci-da-fatturare.CSV")).toBe(true); // 31/08/2026
    expect(isAllowedTicketAttachment("Sinfonia n.5.padmu")).toBe(true);
    expect(isAllowedTicketAttachment("spartito.padmu2")).toBe(true);
  });

  it("e quelle configurate si aggiungono, senza toccare le altre", () => {
    const extra = parseExtraExtensions("dwg");
    expect(isAllowedTicketAttachment("pianta.dwg", extra)).toBe(true);
    expect(isAllowedTicketAttachment("pianta.dwg")).toBe(false);
    expect(isAllowedTicketAttachment("contratto.pdf", extra)).toBe(true);
    // Fuori restano quelle pericolose: la configurazione aggiunge, non apre tutto.
    expect(isAllowedTicketAttachment("logo.svg", extra)).toBe(false);
  });

  it("l'elenco a parole dice anche quelle in più: dirne meno è una bugia", () => {
    expect(attachmentLabel([".dwg"])).toContain(".dwg");
    expect(attachmentLabel()).toBe(TICKET_ATTACHMENT_LABEL);
  });
});

describe("i tipi MIME dichiarati", () => {
  it("ce n'è uno per ogni estensione di casa, e il CSV è text/csv", async () => {
    const { TICKET_ATTACHMENT_EXTENSIONS, TICKET_ATTACHMENT_MIME_TYPES } =
      await import("./ticket-attachments");
    for (const ext of TICKET_ATTACHMENT_EXTENSIONS) {
      expect(TICKET_ATTACHMENT_MIME_TYPES[ext]).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
    }
    expect(TICKET_ATTACHMENT_MIME_TYPES[".csv"]).toBe("text/csv");
  });
});
