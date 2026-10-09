import { escapeHtml } from "@kancrm/shared";
import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { MailMessage } from "./types";
import { logoReference, mailButton, renderMailShell, type LogoEmbed } from "./template";

/**
 * Le email delle sfide di accesso self-service: il LINK di reimpostazione
 * password e il CODICE di accesso via email (OTP). A differenza dell'email
 * della password provvisoria (password-mail.ts), qui non viaggia mai una
 * credenziale duratura: un link che vive trenta minuti, un codice che ne vive
 * dieci — entrambi a un solo uso.
 *
 * Funzioni pure come le sorelle: le impostazioni le legge mail/service.ts.
 */
interface AccessMailOptions {
  to: string;
  locale: string;
  recipientName: string;
  baseUrl: string;
  appName: string;
  brandTitle?: string | null;
  logo?: BrandingLogo | null;
  logoEmbed?: LogoEmbed;
  accentColor?: string;
  intro?: string;
  footer?: string;
}

export function buildPasswordResetLinkEmail(
  options: AccessMailOptions & { resetUrl: string },
): MailMessage {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const accent = options.accentColor || "#7c3aed";
  const brandLogo = logoReference(options.logo ?? null, options.logoEmbed ?? "cid");

  const lead = t("Hai chiesto di reimpostare la password: scegline una nuova da qui.");
  const expiry = t("Il collegamento vale trenta minuti e si usa una volta sola.");
  const warning = t("Se non l'hai chiesto tu, ignora questo messaggio: la tua password non cambia.");

  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "", lead, "",
    options.resetUrl,
    "", expiry, warning, "",
    `— ${options.appName}`,
  ].join("\n");

  return {
    to: options.to,
    subject: `${options.appName} · ${t("Reimposta la password")}`,
    text,
    html: renderMailShell({
      locale: options.locale,
      recipientName: options.recipientName,
      appName: options.appName,
      brandTitle: options.brandTitle,
      logoSrc: brandLogo.src,
      baseUrl: options.baseUrl,
      intro: options.intro,
      footer: options.footer,
      bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.5;color:#111827">${escapeHtml(lead)}</p>
                ${mailButton(options.resetUrl, t("Reimposta la password"), accent, options.locale)}
                <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#4b5563">${escapeHtml(expiry)}</p>
                <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(warning)}</p>`,
      reason: t("— ricevi questo messaggio perché è stata chiesta la reimpostazione della password."),
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}

export function buildLoginCodeEmail(options: AccessMailOptions & { code: string }): MailMessage {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const brandLogo = logoReference(options.logo ?? null, options.logoEmbed ?? "cid");

  const lead = t("Il tuo codice di accesso:");
  const expiry = t("Vale dieci minuti e si usa una volta sola.");
  const warning = t("Se non stai provando a entrare tu, ignora questo messaggio.");

  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "", lead, "",
    options.code,
    "", expiry, warning, "",
    `— ${options.appName}`,
  ].join("\n");

  // il codice grande e in carattere fisso: si legge da un telefono e si
  // ricopia a colpo d'occhio, sei cifre senza ambiguità
  const codeBox = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
        <tr><td align="center" style="padding:18px 16px">
          <div style="font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;color:#111827">${escapeHtml(options.code)}</div>
        </td></tr>
      </table>`;

  return {
    to: options.to,
    subject: `${options.appName} · ${t("Codice di accesso")} ${options.code}`,
    text,
    html: renderMailShell({
      locale: options.locale,
      recipientName: options.recipientName,
      appName: options.appName,
      brandTitle: options.brandTitle,
      logoSrc: brandLogo.src,
      baseUrl: options.baseUrl,
      intro: options.intro,
      footer: options.footer,
      bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.5;color:#111827">${escapeHtml(lead)}</p>
                ${codeBox}
                <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#4b5563">${escapeHtml(expiry)}</p>
                <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(warning)}</p>`,
      reason: t("— ricevi questo messaggio perché è stato chiesto un codice di accesso."),
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}

/**
 * Codice per SBLOCCARE un messaggio riservato: testo diverso dal login, perché
 * chi lo riceve deve capire cosa sta autorizzando.
 */
export function buildUnlockCodeEmail(options: AccessMailOptions & { code: string }): MailMessage {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  return {
    to: options.to,
    subject: t("Codice per sbloccare un messaggio riservato: {{code}}", { code: options.code }),
    text: [
      t("Ciao {{name}},", { name: options.recipientName }),
      "",
      t("il codice per sbloccare il messaggio riservato è:"),
      "",
      options.code,
      "",
      t("Vale dieci minuti e si usa una volta sola."),
      t("Se non sei stato tu a chiederlo, ignora questo messaggio."),
      "",
      `— ${options.appName}`,
    ].join("\n"),
  };
}
