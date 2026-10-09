import { escapeHtml } from "@kancrm/shared";
import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { MailMessage } from "./types";
import { logoReference, mailButton, renderMailShell, type LogoEmbed } from "./template";

/**
 * L'avviso agli amministratori quando un account si chiude per troppe
 * password sbagliate. Dice chi, quanti tentativi, fino a quando — e porta
 * alla pagina Utenti, dove si azzera il freno o si reimposta la password.
 * Niente password, niente indirizzi IP: il fatto basta.
 */
export function buildLockoutAlertEmail(options: {
  to: string;
  locale: string;
  recipientName: string;
  account: { name: string; email: string };
  attempts: number;
  lockedUntil: Date | null;
  baseUrl: string;
  appName: string;
  brandTitle?: string | null;
  logo?: BrandingLogo | null;
  logoEmbed?: LogoEmbed;
  accentColor?: string;
  intro?: string;
  footer?: string;
}): MailMessage {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const accent = options.accentColor || "#7c3aed";
  const brandLogo = logoReference(options.logo ?? null, options.logoEmbed ?? "cid");
  const url = options.baseUrl.replace(/\/+$/, "");
  const fino = options.lockedUntil
    ? new Intl.DateTimeFormat(options.locale, {
        timeZone: "Europe/Rome",
        dateStyle: "short",
        timeStyle: "short",
      }).format(options.lockedUntil)
    : null;

  const lead = t(
    "L'account di {{name}} ({{email}}) ha ricevuto {{n}} password sbagliate di fila.",
    {
      name: options.account.name,
      email: options.account.email,
      n: options.attempts,
    },
  );
  const stato = fino
    ? t(
        "L'accesso è chiuso fino alle {{time}}; ogni altro errore raddoppia l'attesa, fino a 100 minuti.",
        { time: fino },
      )
    : t("Ogni altro errore chiuderà l'accesso per un tempo crescente, fino a 100 minuti.");
  const cosaFare = t(
    "Se è la persona giusta che non ricorda la password, da «Utenti» puoi azzerare il freno o reimpostarla. Se non la riconosci, è qualcuno che prova a entrare.",
  );

  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "",
    lead,
    stato,
    "",
    cosaFare,
    ...(url ? ["", `${t("Apri Utenti")}: ${url}/utenti`] : []),
  ].join("\n");

  const bodyHtml = [
    `<p style="margin:0 0 16px">${escapeHtml(lead)}</p>`,
    `<p style="margin:0 0 16px"><strong>${escapeHtml(stato)}</strong></p>`,
    `<p style="margin:0 0 24px">${escapeHtml(cosaFare)}</p>`,
    url ? mailButton(`${url}/utenti`, t("Apri Utenti"), accent, options.locale) : "",
  ].join("");

  return {
    to: options.to,
    subject: `${t("Accesso bloccato: {{name}}", { name: options.account.name })} — ${options.brandTitle || options.appName}`,
    text,
    html: renderMailShell({
      locale: options.locale,
      recipientName: options.recipientName,
      appName: options.appName,
      brandTitle: options.brandTitle,
      logoSrc: brandLogo.src,
      baseUrl: url,
      intro: options.intro,
      footer: options.footer,
      bodyHtml,
      reason: t("Ricevi questo messaggio perché sei amministratore di {{app}}.", {
        app: options.brandTitle || options.appName,
      }),
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}
