import { escapeHtml, NotificationType, TaskKind } from "@kancrm/shared";
import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { NotificationRef } from "./notification-mail";
import type { InlineImage } from "./types";

/**
 * Il template HTML delle email di notifica.
 *
 * Scritto come si scrivevano i siti vent'anni fa — tabelle e stili in linea — e
 * non per nostalgia: i client di posta buttano via i fogli di stile esterni,
 * molti ignorano flex e grid, e Outlook rende il CSS moderno in modo
 * imprevedibile. Un layout a tabella con `style=""` è l'unica cosa che si legge
 * uguale ovunque.
 *
 * Regole che il template rispetta:
 * - **si legge anche senza immagini**: molti client le bloccano, quindi il logo
 *   è un di più e mai l'unico modo di capire chi scrive;
 * - **il pulsante è un link**, non un bottone: un `<button>` in un'email non fa
 *   niente. Ha un colore di sfondo e resta cliccabile anche da chi legge in
 *   testo semplice, perché l'indirizzo è ripetuto sotto;
 * - **niente link finti**: senza indirizzo pubblico configurato il pulsante non
 *   si disegna affatto;
 * - **il logo viaggia dentro il messaggio**, non lo si va a prendere sul nostro
 *   server: vedi `logoReference`.
 */

/** Identificatore del logo dentro il messaggio: `<img src="cid:...">`. */
const LOGO_CID = "keelops-logo";

/**
 * Come si fa vedere il logo. Due modi, e nessuno dei due è un indirizzo del
 * nostro server:
 *
 * - **`cid`** (le email vere): l'immagine è una parte del messaggio, richiamata
 *   dall'HTML. Così si vede anche a server irraggiungibile, con certificato
 *   interno, o dietro il proxy immagini di Gmail — che il nostro indirizzo non
 *   lo raggiunge e comunque non si fiderebbe di un certificato firmato in casa.
 *   Era esattamente il caso del 06/08/2026: l'immagine restava rotta.
 * - **`data`** (l'anteprima in pagina): un `data:` URI, perché l'anteprima gira
 *   in un iframe isolato dove un `cid:` non significa niente.
 */
export type LogoEmbed = "cid" | "data";

export function logoReference(
  logo: BrandingLogo | null,
  embed: LogoEmbed,
): { src: string | null; inlineImages: InlineImage[] } {
  if (!logo) return { src: null, inlineImages: [] };
  if (embed === "data") {
    return {
      src: `data:${logo.contentType};base64,${logo.content.toString("base64")}`,
      inlineImages: [],
    };
  }
  return {
    src: `cid:${LOGO_CID}`,
    inlineImages: [
      {
        cid: LOGO_CID,
        filename: logo.filename,
        contentType: logo.contentType,
        content: logo.content,
      },
    ],
  };
}

/** Cosa apre il pulsante, detto all'utente nella sua lingua. */
export function recordLabel(notification: NotificationRef, locale: string): string {
  const t = (key: string) => serverT(locale, key);
  if (!notification.taskId) {
    return notification.type === NotificationType.DUE_DIGEST
      ? t("Apri le scadenze")
      : t("Apri KeelOps");
  }
  if (notification.taskKind === TaskKind.DEAL) return t("Apri l'offerta");
  if (notification.taskKind === TaskKind.TICKET) return t("Apri il ticket");
  if (notification.taskKind === TaskKind.PROJECT) return t("Apri il task di progetto");
  return t("Apri il task");
}

export interface EmailTemplateOptions {
  /** Lingua del destinatario: soggetto, pulsante e cornice escono così. */
  locale: string;
  recipientName: string;
  notification: NotificationRef;
  /** Indirizzo del record, o null se l'applicazione non ha un indirizzo pubblico. */
  url: string | null;
  /** Radice dell'applicazione, per il collegamento in fondo. */
  baseUrl: string;
  appName: string;
  /** Marchio aziendale, se configurato: sostituisce il nome nell'intestazione. */
  brandTitle?: string | null;
  /** Sorgente del logo da `logoReference`, non un indirizzo scritto a mano. */
  logoSrc?: string | null;
  accentColor?: string;
  intro?: string;
  footer?: string;
}

/**
 * La cornice: intestazione col marchio, saluto, contenuto, piè di pagina.
 *
 * Sta a parte perché le email non sono tutte notifiche — le credenziali
 * provvisorie di un reset password non lo sono (`password-mail.ts`) — e
 * ricopiare l'impalcatura a tabelle voleva dire tenerne allineate due: al primo
 * ritocco del marchio una delle due sarebbe rimasta indietro. Il **corpo** lo
 * scrive chi chiama, già in HTML e già ripulito.
 */
export interface MailShellOptions {
  locale: string;
  recipientName: string;
  appName: string;
  brandTitle?: string | null;
  logoSrc?: string | null;
  /** Radice dell'applicazione, per il collegamento in fondo. */
  baseUrl: string;
  intro?: string;
  footer?: string;
  /** HTML del corpo: chi chiama ha già scappato ciò che veniva dai dati. */
  bodyHtml: string;
  /**
   * La riga finale che spiega *perché* è arrivato questo messaggio. Cambia col
   * tipo di email — "ti riguarda una notifica" non ha senso su un reset
   * password — quindi la decide chi compone.
   */
  reason?: string;
}

/** Il pulsante-link: un `<button>` in un'email non fa niente. */
export function mailButton(url: string, label: string, accent: string, locale: string): string {
  const t = (key: string) => serverT(locale, key);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
            <tr>
              <td style="border-radius:6px;background:${escapeHtml(accent)}">
                <a href="${escapeHtml(url)}"
                   style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">
                  ${escapeHtml(label)} &rarr;
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#6b7280">
            ${escapeHtml(t("Se il pulsante non funziona, copia questo indirizzo:"))}<br />
            <a href="${escapeHtml(url)}" style="color:${escapeHtml(accent)}">${escapeHtml(url)}</a>
          </p>`;
}

export function renderNotificationHtml(options: EmailTemplateOptions): string {
  const accent = options.accentColor || "#7c3aed";
  const button = options.url
    ? mailButton(
        options.url,
        recordLabel(options.notification, options.locale),
        accent,
        options.locale,
      )
    : "";
  return renderMailShell({
    ...options,
    bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.5;color:#111827">${escapeHtml(options.notification.text)}</p>
                ${button}`,
    reason: serverT(
      options.locale,
      "— ricevi questo messaggio perché la notifica ti riguarda. Puoi spegnerne i tipi dalla campanella, sezione preferenze.",
    ),
  });
}

export function renderMailShell(options: MailShellOptions): string {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const heading = escapeHtml(options.brandTitle || options.appName);
  const intro = options.intro?.trim();
  const footer = options.footer?.trim();

  const logo = options.logoSrc
    ? `<img src="${escapeHtml(options.logoSrc)}" alt="${heading}" height="32" style="display:block;border:0;max-height:32px" />`
    : `<span style="font-size:18px;font-weight:600;color:#111827">${heading}</span>`;

  return `<!doctype html>
<html lang="${escapeHtml(options.locale)}">
  <body style="margin:0;padding:0;background:#f3f4f6">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb">${logo}</td>
            </tr>
            <tr>
              <td style="padding:24px">
                <p style="margin:0 0 16px;font-size:15px;color:#111827">${escapeHtml(t("Ciao {{name}},", { name: options.recipientName }))}</p>
                ${intro ? `<p style="margin:0 0 16px;font-size:14px;color:#4b5563">${escapeHtml(intro)}</p>` : ""}
                ${options.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">
                ${footer ? `${escapeHtml(footer)}<br />` : ""}
                ${
                  // `heading` è già escapato a inizio funzione: ri-escaparlo qui
                  // raddoppiava le entità (un "&" nel titolo diventava "&amp;amp;").
                  options.baseUrl
                    ? `<a href="${escapeHtml(options.baseUrl)}" style="color:#6b7280">${heading}</a>`
                    : heading
                }
                ${options.reason ? escapeHtml(options.reason) : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
