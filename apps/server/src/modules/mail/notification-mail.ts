import { NotificationType, TaskKind } from "@kancrm/shared";
import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { MailMessage } from "./types";
import { logoReference, renderNotificationHtml, type LogoEmbed } from "./template";

/**
 * Da una notifica al messaggio da spedire.
 *
 * L'email dice la stessa cosa della campanella e porta allo stesso posto: il
 * testo è già scritto in italiano dal server, qui si aggiunge solo il
 * collegamento. Le regole di destinazione sono le stesse della UI
 * (`web/features/tasks/record-target.ts`) — un'offerta apre l'offerta, un
 * riepilogo scadenze apre l'agenda — perché chi riceve l'email si aspetta di
 * atterrare dove atterrerebbe cliccando la notifica.
 */

export interface NotificationRef {
  type: string;
  text: string;
  taskId?: string | null;
  taskKind?: string | null;
}

/**
 * Dove si apre un record nell'applicazione: **la mappa kind→indirizzo, in un
 * posto solo**. La usano le email (qui) e i calendari (`calendar/routes.ts`);
 * prima era copiata, e la promessa "quando i ticket avranno un indirizzo cambia
 * solo questa riga" valeva per una copia sola. Ora vale per tutte.
 */
export function taskRecordUrl(
  base: string,
  taskId: string,
  taskKind: string | null,
  /**
   * **Un cliente del portale non ha le stesse pagine.** Il suo mondo è l'elenco
   * delle proprie richieste: mandarlo a `/bacheche` — che nel portale non
   * esiste — voleva dire farlo atterrare su una lista muta, e da lì l'email
   * sembrava rotta (02/09/2026). Finché il portale non avrà un indirizzo per la
   * singola richiesta, si apre casa sua: cambia solo questa riga.
   */
  perIlPortale = false,
): string {
  if (perIlPortale) return base;
  if (taskKind === TaskKind.DEAL) return `${base}/offerte?deal=${taskId}`;
  // I ticket non hanno ancora un indirizzo diretto: si apre l'elenco, che è
  // comunque il posto giusto. Quando ci sarà, cambia solo questa riga.
  if (taskKind === TaskKind.TICKET) return `${base}/ticket`;
  return `${base}/bacheche?task=${taskId}`;
}

/** Indirizzo pubblico del record, o della pagina che lo contiene. */
export function notificationUrl(
  baseUrl: string,
  notification: NotificationRef,
  perIlPortale = false,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const { taskId, taskKind } = notification;
  if (perIlPortale) return base;
  if (taskId) return taskRecordUrl(base, taskId, taskKind ?? null);
  if (notification.type === NotificationType.DUE_DIGEST) return `${base}/bacheche`;
  if (notification.type === NotificationType.TIMESHEET_REMINDER) return `${base}/timesheet`;
  return base;
}

/** Oggetto: corto, riconoscibile nella lista della posta, nella lingua di chi legge. */
export function notificationSubject(
  notification: NotificationRef,
  appName: string,
  locale: string,
): string {
  const prefix = serverT(
    locale,
    notification.type === NotificationType.DUE_DIGEST ? "Scadenze" : "Notifica",
  );
  return `${appName} · ${prefix}`;
}

export function buildNotificationEmail(options: {
  to: string;
  /** Lingua del destinatario: soggetto, cornice ed etichette escono così. */
  locale: string;
  recipientName: string;
  notification: NotificationRef;
  baseUrl: string;
  appName: string;
  /** Marchio e template: arrivano dalle impostazioni, non dal codice. */
  brandTitle?: string | null;
  /** Il file del logo: viaggia dentro il messaggio. */
  logo?: BrandingLogo | null;
  /** `cid` per le email vere, `data` per l'anteprima in pagina. */
  logoEmbed?: LogoEmbed;
  accentColor?: string;
  intro?: string;
  footer?: string;
  /** Chi legge è un cliente del portale: le sue pagine non sono le nostre. */
  perIlPortale?: boolean;
}): MailMessage {
  const brandLogo = logoReference(options.logo ?? null, options.logoEmbed ?? "cid");
  // Senza indirizzo pubblico configurato (APP_BASE_URL) non si scrive un link:
  // uno che porta al localhost del server è peggio della sua assenza.
  const url = options.baseUrl
    ? notificationUrl(options.baseUrl, options.notification, options.perIlPortale ?? false)
    : null;
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "",
    options.notification.text,
    ...(url ? ["", t("Apri: {{url}}", { url })] : []),
    "",
    `— ${options.appName}`,
  ].join("\n");
  return {
    to: options.to,
    subject: notificationSubject(options.notification, options.appName, options.locale),
    text,
    // L'HTML è il vestito; il testo resta la sostanza, e chi legge in testo
    // semplice (o blocca l'HTML) non perde niente.
    html: renderNotificationHtml({
      locale: options.locale,
      recipientName: options.recipientName,
      notification: options.notification,
      url,
      baseUrl: options.baseUrl,
      appName: options.appName,
      brandTitle: options.brandTitle,
      logoSrc: brandLogo.src,
      accentColor: options.accentColor,
      intro: options.intro,
      footer: options.footer,
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}
