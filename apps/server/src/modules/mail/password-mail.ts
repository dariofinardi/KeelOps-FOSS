import { escapeHtml } from "@kancrm/shared";
import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { MailMessage } from "./types";
import { logoReference, mailButton, renderMailShell, type LogoEmbed } from "./template";

/**
 * L'email che accompagna una password reimpostata da un amministratore.
 *
 * **Mandare una password per posta non è una bella pratica**, e qui si fa a
 * occhi aperti: è l'unico canale che l'azienda ha verso una persona che, per
 * definizione, in questo momento non riesce a entrare. Le contromisure sono
 * tre, e stanno tutte insieme:
 *  - la password **vive un accesso**: al primo ingresso l'applicazione ne
 *    chiede una nuova (`User.mustChangePassword`) e questa smette di valere;
 *  - il reset **chiude tutte le sessioni** dell'utente, quindi non è una chiave
 *    che si aggiunge alle altre;
 *  - il messaggio dice **chi** l'ha fatto e cosa fare se non era atteso: una
 *    reimpostazione non richiesta è la prima cosa da segnalare.
 *
 * Funzione pura, come `buildNotificationEmail`: le impostazioni le legge chi
 * chiama (`mail/service.ts`), qui si compone e basta.
 */
export function buildPasswordResetEmail(options: {
  to: string;
  /** Lingua del destinatario: l'email esce nella sua, non in quella dell'admin. */
  locale: string;
  recipientName: string;
  /** La password provvisoria in chiaro: esiste solo in questo messaggio. */
  password: string;
  /** Indirizzo pubblico dell'applicazione; vuoto = niente pulsante, niente link finti. */
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

  const lead = t("Un amministratore ha reimpostato la tua password.");
  const firstLogin = t(
    "Al primo accesso ti verrà chiesto di sceglierne una nuova: questa vale una volta sola.",
  );
  const warning = t(
    "Se non hai chiesto tu questa reimpostazione, avvisa subito un amministratore.",
  );

  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "",
    lead,
    "",
    `${t("Indirizzo email")}: ${options.to}`,
    `${t("Password provvisoria")}: ${options.password}`,
    ...(url ? ["", `${t("Entra da qui")}: ${url}`] : []),
    "",
    firstLogin,
    warning,
    "",
    `— ${options.appName}`,
  ].join("\n");

  // Le credenziali in un riquadro a parte e in carattere fisso: la password si
  // deve poter selezionare con un doppio clic e rileggere carattere per
  // carattere, senza confondersi con la frase intorno.
  const credentials = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
        <tr>
          <td style="padding:14px 16px;font-size:14px;color:#111827">
            <div style="margin:0 0 6px;color:#6b7280;font-size:12px">${escapeHtml(t("Indirizzo email"))}</div>
            <div style="margin:0 0 12px;font-family:Menlo,Consolas,monospace">${escapeHtml(options.to)}</div>
            <div style="margin:0 0 6px;color:#6b7280;font-size:12px">${escapeHtml(t("Password provvisoria"))}</div>
            <div style="margin:0;font-family:Menlo,Consolas,monospace;font-size:18px;letter-spacing:1px">${escapeHtml(options.password)}</div>
          </td>
        </tr>
      </table>`;

  return {
    to: options.to,
    subject: `${options.appName} · ${t("Password reimpostata")}`,
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
                ${credentials}
                ${url ? mailButton(url, t("Entra in {{app}}", { app: options.appName }), accent, options.locale) : ""}
                <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#4b5563">${escapeHtml(firstLogin)}</p>
                <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(warning)}</p>`,
      reason: t("— ricevi questo messaggio perché la tua password è stata reimpostata."),
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}
