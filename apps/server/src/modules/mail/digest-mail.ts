// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { serverT } from "../../i18n";
import type { BrandingLogo } from "../branding/logo";
import type { MailMessage } from "./types";
import { notificationUrl, type NotificationRef } from "./notification-mail";
import { escapeHtml } from "@kancrm/shared";
import { logoReference, renderMailShell, type LogoEmbed } from "./template";

/**
 * **Un'email sola al posto di quattordici.**
 *
 * Otto minuti di lavoro di un collega su cinque task hanno prodotto quattordici
 * email, quasi tutte sullo stesso pugno di record: a quel punto non si legge
 * più niente, e la posta di KeelOps diventa qualcosa da archiviare in blocco
 * (misurato il 04/09/2026). Qui gli avvisi accumulati diventano un messaggio
 * solo.
 *
 * Il raggruppamento è **quello della campanella**, non uno nuovo: più avvisi
 * sullo stesso record valgono per uno, si legge il più recente e si dice quanti
 * ne rappresenta. Chi apre l'email deve ritrovare esattamente ciò che troverà
 * nell'applicazione.
 */
export interface DigestEntry extends NotificationRef {
  createdAt: Date;
}

export interface DigestGroup {
  /** Il tipo dell'avviso più recente: decide dove porta il collegamento. */
  type: string;
  /** Il testo più recente del gruppo: è quello che si legge. */
  text: string;
  /** Quanti avvisi rappresenta (1 = uno solo). */
  count: number;
  taskId: string | null;
  taskKind: string | null;
}

/**
 * Dal mucchio ai gruppi, dal più recente. **Chi non parla di un record non si
 * raggruppa**: il riepilogo scadenze e gli avvisi di sistema non hanno un task
 * dietro, e accorparli per tipo nasconderebbe cose diverse sotto la stessa riga.
 */
export function raggruppa(voci: DigestEntry[]): DigestGroup[] {
  const perTask = new Map<string, DigestGroup>();
  const gruppi: DigestGroup[] = [];
  for (const voce of [...voci].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const gruppo: DigestGroup = {
      text: voce.text,
      count: 1,
      type: voce.type,
      taskId: voce.taskId ?? null,
      taskKind: voce.taskKind ?? null,
    };
    if (!voce.taskId) {
      gruppi.push(gruppo);
      continue;
    }
    const esistente = perTask.get(voce.taskId);
    if (esistente) {
      // Il testo resta quello del più recente: l'elenco è già ordinato.
      esistente.count += 1;
      continue;
    }
    perTask.set(voce.taskId, gruppo);
    gruppi.push(gruppo);
  }
  return gruppi;
}

/** Oggetto: quante cose sono successe, non quale sia l'ultima. */
export function digestSubject(appName: string, count: number, locale: string): string {
  return `${appName} · ${serverT(locale, "{{count}} avvisi", { count })}`;
}

export function buildDigestEmail(options: {
  to: string;
  locale: string;
  recipientName: string;
  entries: DigestEntry[];
  accentColor?: string;
  baseUrl: string;
  appName: string;
  brandTitle?: string | null;
  logo?: BrandingLogo | null;
  logoEmbed?: LogoEmbed;
  intro?: string;
  footer?: string;
  /** Chi legge è un cliente del portale: le sue pagine non sono le nostre. */
  perIlPortale?: boolean;
}): MailMessage {
  const t = (key: string, params?: Record<string, string | number>) =>
    serverT(options.locale, key, params);
  const gruppi = raggruppa(options.entries);
  const brandLogo = logoReference(options.logo ?? null, options.logoEmbed ?? "cid");
  const base = options.baseUrl.replace(/\/+$/, "");
  const accent = options.accentColor || "#7c3aed";
  // Lo stesso indirizzo dell'email singola (notificationUrl): il record se
  // c'è, le scadenze per il riepilogo, il timesheet per il promemoria. Prima
  // chi non aveva un task finiva sulla pagina di casa, e il collegamento era
  // scritto senza sottolineatura: non si vedeva (06/09/2026).
  const link = (gruppo: DigestGroup): string | null => {
    if (!base) return null;
    return notificationUrl(
      base,
      {
        type: gruppo.type as NotificationRef["type"],
        text: gruppo.text,
        taskId: gruppo.taskId,
        taskKind: gruppo.taskKind,
      },
      options.perIlPortale,
    );
  };
  const riga = (gruppo: DigestGroup): string =>
    gruppo.count > 1
      ? `${gruppo.text} (${t("e altri {{count}} aggiornamenti", { count: gruppo.count - 1 })})`
      : gruppo.text;

  const text = [
    t("Ciao {{name}},", { name: options.recipientName }),
    "",
    t("ecco cosa è successo mentre non guardavi."),
    "",
    ...gruppi.flatMap((gruppo) => {
      const url = link(gruppo);
      return [`• ${riga(gruppo)}`, ...(url ? [`  ${url}`] : [])];
    }),
    "",
    `— ${options.appName}`,
  ].join("\n");

  const voci = gruppi
    .map((gruppo) => {
      const url = link(gruppo);
      const testo = escapeHtml(riga(gruppo));
      const corpo = url
        ? `${testo} <a href="${escapeHtml(url)}" style="color:${accent};text-decoration:underline;white-space:nowrap">${escapeHtml(t("Apri"))} →</a>`
        : testo;
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:15px;line-height:1.5;color:#111827">${corpo}</td></tr>`;
    })
    .join("");

  return {
    to: options.to,
    subject: digestSubject(options.appName, options.entries.length, options.locale),
    text,
    html: renderMailShell({
      locale: options.locale,
      recipientName: options.recipientName,
      baseUrl: options.baseUrl,
      appName: options.appName,
      brandTitle: options.brandTitle,
      logoSrc: brandLogo.src,
      intro: options.intro,
      footer: options.footer,
      bodyHtml: `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#111827">${escapeHtml(
        t("ecco cosa è successo mentre non guardavi."),
      )}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${voci}</table>`,
      reason: t(
        "— ricevi un riepilogo invece di un'email per avviso: si cambia dalla campanella, sezione preferenze.",
      ),
    }),
    ...(brandLogo.inlineImages.length ? { inlineImages: brandLogo.inlineImages } : {}),
  };
}
