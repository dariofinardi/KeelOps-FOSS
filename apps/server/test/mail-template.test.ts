// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { NotificationType, TaskKind } from "@kancrm/shared";
import { logoReference, recordLabel, renderNotificationHtml } from "../src/modules/mail/template";

const base = {
  locale: "it",
  recipientName: "Francesca",
  baseUrl: "https://crm.esempio.it",
  appName: "KeelOps",
};

const render = (over: Partial<Parameters<typeof renderNotificationHtml>[0]> = {}) =>
  renderNotificationHtml({
    ...base,
    notification: { type: NotificationType.TASK_ASSIGNED, text: "Ti è stato assegnato un task" },
    url: "https://crm.esempio.it/scadenzario?task=t1",
    ...over,
  });

describe("template HTML delle notifiche", () => {
  it("il pulsante dice cosa apre, secondo il tipo di record", () => {
    expect(recordLabel({ type: "x", text: "", taskId: "t1", taskKind: TaskKind.DEAL }, "it")).toBe(
      "Apri l'offerta",
    );
    expect(recordLabel({ type: "x", text: "", taskId: "t1", taskKind: TaskKind.TICKET }, "it")).toBe(
      "Apri il ticket",
    );
    expect(recordLabel({ type: "x", text: "", taskId: "t1", taskKind: TaskKind.PROJECT }, "it")).toBe(
      "Apri il task di progetto",
    );
    // Senza record, il riepilogo scadenze porta comunque da qualche parte.
    expect(recordLabel({ type: NotificationType.DUE_DIGEST, text: "", taskId: null }, "it")).toBe(
      "Apri le scadenze",
    );
  });

  it("il link compare due volte: nel pulsante e in chiaro", () => {
    // I client di posta rompono i pulsanti in mille modi: l'indirizzo scritto
    // per esteso è la via di scampo di chi non riesce a cliccare.
    const html = render();
    const occorrenze = html.split("https://crm.esempio.it/scadenzario?task=t1").length - 1;
    expect(occorrenze).toBeGreaterThanOrEqual(2);
  });

  it("senza indirizzo pubblico non disegna un pulsante che non porta da nessuna parte", () => {
    const html = render({ url: null, baseUrl: "" });
    expect(html).not.toContain("Apri il task");
    expect(html).toContain("Ti è stato assegnato un task"); // il messaggio resta
  });

  it("il logo compare solo se c'è, e il nome regge da solo quando manca", () => {
    expect(render({ logoSrc: "cid:keelops-logo" })).toContain("<img");
    const senzaLogo = render({ brandTitle: "Jugaad" });
    expect(senzaLogo).not.toContain("<img");
    expect(senzaLogo).toContain("Jugaad");
  });

  describe("come il logo entra nel messaggio", () => {
    const logo = {
      filename: "logo.png",
      contentType: "image/png",
      content: Buffer.from("finta immagine"),
    };

    it("nelle email viaggia dentro il messaggio, non su un indirizzo nostro", () => {
      // È il motivo per cui il logo restava rotto: un `src` remoto obbliga il
      // client del destinatario a raggiungere il nostro server e a fidarsi del
      // suo certificato. Con il `cid` l'immagine è già lì.
      const { src, inlineImages } = logoReference(logo, "cid");
      expect(src).toBe("cid:keelops-logo");
      expect(inlineImages).toHaveLength(1);
      expect(inlineImages[0]).toMatchObject({ cid: "keelops-logo", contentType: "image/png" });
      expect(render({ logoSrc: src })).toContain('src="cid:keelops-logo"');
    });

    it("nell'anteprima diventa un data: URI, perché lì un cid non esiste", () => {
      const { src, inlineImages } = logoReference(logo, "data");
      expect(src).toBe(`data:image/png;base64,${Buffer.from("finta immagine").toString("base64")}`);
      expect(inlineImages).toEqual([]);
    });

    it("senza logo configurato non si incorpora niente", () => {
      expect(logoReference(null, "cid")).toEqual({ src: null, inlineImages: [] });
    });
  });

  it("il testo di una notifica non può iniettare marcatori", () => {
    // Il testo lo compone il server, ma passa da titoli scritti dagli utenti:
    // un titolo con un tag dentro non deve diventare parte del documento.
    const html = render({
      notification: {
        type: NotificationType.MENTION,
        text: 'Titolo <img src=x onerror="alert(1)"> "cattivo"',
      },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("un & nel nome del marchio non si raddoppia nel footer", () => {
    // Il difetto: heading era già escapato, e il footer lo ri-escapava:
    // "Rossi & Figli" diventava "Rossi &amp;amp; Figli" nella riga in fondo.
    const html = render({ brandTitle: "Rossi & Figli" });
    expect(html).toContain("Rossi &amp; Figli");
    expect(html).not.toContain("&amp;amp;");
  });

  it("apertura e chiusura configurate finiscono nel messaggio", () => {
    const html = render({ intro: "Aggiornamento dal gestionale", footer: "Team KeelOps" });
    expect(html).toContain("Aggiornamento dal gestionale");
    expect(html).toContain("Team KeelOps");
  });
});
