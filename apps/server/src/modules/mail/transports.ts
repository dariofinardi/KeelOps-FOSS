// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { smtpHandshake } from "./connection";
import type { MailMessage, MailTransport } from "./types";

/**
 * Trasporti disponibili. Il **mockup** è quello di log: scrive nel registro cosa
 * sarebbe partito, senza spedire niente e senza chiedere credenziali. Serve per
 * provare tutto il percorso — chi riceve, con che oggetto, con quale link —
 * prima di collegare un server vero.
 */

/** Sviluppo e collaudo: non spedisce, racconta. */
export function logTransport(log: (message: string) => void = console.info): MailTransport {
  return {
    name: "log",
    async send(message) {
      log(`[mail] → ${message.to} · ${message.subject}\n${message.text}`);
    },
  };
}

/** Nei test: tiene i messaggi in memoria per poterli controllare. */
export function memoryTransport(): MailTransport & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    name: "memoria",
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export interface SmtpSettings {
  host: string;
  port: number;
  /**
   * "La connessione dev'essere cifrata". NON vuol dire "TLS dal primo byte":
   * quello lo decide la porta (vedi `smtpHandshake`).
   */
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * Server SMTP (SendGrid, Postmark, il relay aziendale…).
 *
 * Il client vero è `nodemailer`, importato **solo qui e solo quando serve**: il
 * resto dell'applicazione non lo tira dentro, e finché si resta sul trasporto di
 * log non è nemmeno necessario installarlo. Con SendGrid l'utente è la parola
 * `apikey` e la password è la chiave API (host `smtp.sendgrid.net`, porta 587).
 *
 * Se il pacchetto manca, l'errore lo dice: meglio fermarsi all'avvio con una
 * frase chiara che scoprirlo alla prima notifica non recapitata.
 */
interface Mailer {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

export function smtpTransport(settings: SmtpSettings): MailTransport {
  let mailer: Mailer | null = null;

  return {
    name: "smtp",
    async send(message: MailMessage) {
      if (!mailer) {
        // Import dinamico: nodemailer si carica alla prima spedizione, non
        // all'avvio. Un'installazione che non manda email non paga il costo.
        const nodemailer = (await import("nodemailer")) as unknown as {
          default: { createTransport(options: object): Mailer };
        };
        // La porta decide la stretta di mano; il flag dice solo se il cifrato
        // è obbligatorio. Vedi connection.ts: invertirli fa fallire l'handshake
        // con "wrong version number".
        const handshake = smtpHandshake(settings.port, settings.secure);
        mailer = nodemailer.default.createTransport({
          host: settings.host,
          port: settings.port,
          secure: handshake.secure,
          requireTLS: handshake.requireTLS,
          auth: { user: settings.user, pass: settings.password },
        });
      }
      await mailer.sendMail({
        from: settings.from,
        to: message.to,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        // `cid` + `contentDisposition: inline` = l'immagine fa parte del
        // messaggio e non compare come allegato da scaricare.
        // Immagini incorporate e allegati veri viaggiano nello stesso elenco di
        // nodemailer: a distinguerli è `contentDisposition`.
        ...(message.inlineImages?.length || message.attachments?.length
          ? {
              attachments: [
                ...(message.inlineImages ?? []).map((image) => ({
                  cid: image.cid,
                  filename: image.filename,
                  contentType: image.contentType,
                  content: image.content,
                  contentDisposition: "inline" as const,
                })),
                ...(message.attachments ?? []).map((file) => ({
                  filename: file.filename,
                  contentType: file.contentType,
                  content: file.content,
                  contentDisposition: "attachment" as const,
                })),
              ],
            }
          : {}),
      });
    },
  };
}
