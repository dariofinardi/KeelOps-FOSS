// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { escapeHtml } from "@kancrm/shared";
import { config } from "../config";
import { prisma } from "../db";
import { serverT } from "../i18n";
import { mailEnabled, sendNow } from "../modules/mail/service";
import { readMailBrand, readMailSettings } from "../modules/mail/settings";
import { logoReference, renderMailShell } from "../modules/mail/template";

/**
 * **La posta, prestata ai plugin** (29/09/2026, per il rapportino firmato da
 * mandare al cliente).
 *
 * Un plugin non apre un suo SMTP e non legge le credenziali del core: passa di
 * qui, e il messaggio esce con il canale, il mittente e il marchio di KeelOps
 * — la stessa cornice delle altre email. Solo a chi la chiede nel manifesto
 * (`mail:send`).
 *
 * Tre scelte:
 * - **il corpo è testo**, non HTML: la porta lo scappa e lo mette in
 *   paragrafi. Un plugin che compone HTML per un indirizzo esterno è un plugin
 *   che un giorno ci infila dentro il nome di un cliente senza scapparlo;
 * - **si risponde a chi manda**: il cliente che risponde al rapportino scrive
 *   al tecnico, non a una casella tecnica che nessuno legge;
 * - **un destinatario per messaggio**, come tutta la posta del core.
 *
 * Torna `{ inviata: false, motivo }` invece di lanciare quando la posta non è
 * configurata o il server la rifiuta: il plugin lo dice a chi ha premuto il
 * pulsante, e il documento resta comunque dov'era.
 */

export interface EmailDaPlugin {
  to: string;
  /** Il nome del destinatario, per il saluto. */
  toName?: string | null;
  /** La lingua del messaggio (cornice compresa); di serie l'italiano. */
  locale?: string | null;
  subject: string;
  /** Il corpo, in testo semplice: una riga vuota separa i paragrafi. */
  text: string;
  /** La riga in fondo che dice perché è arrivato il messaggio. */
  reason?: string | null;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

const INDIRIZZO = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** Tetto degli allegati di un messaggio: oltre, molti server lo rifiutano. */
const TETTO_ALLEGATI = 10 * 1024 * 1024;

export async function inviaEmailPerPlugin(
  userId: string,
  input: EmailDaPlugin,
): Promise<{ inviata: boolean; motivo?: string }> {
  if (config.demo) return { inviata: false, motivo: "Nella dimostrazione non si mandano email." };
  if (!mailEnabled()) return { inviata: false, motivo: "La posta non è configurata." };
  const to = String(input.to ?? "").trim();
  if (!INDIRIZZO.test(to)) throw new Error("indirizzo email non valido");
  const subject = String(input.subject ?? "")
    .trim()
    .slice(0, 200);
  if (!subject) throw new Error("oggetto mancante");
  const text = String(input.text ?? "");
  const allegati = input.attachments ?? [];
  const peso = allegati.reduce((somma, a) => somma + (a.content?.length ?? 0), 0);
  if (peso > TETTO_ALLEGATI) throw new Error("allegati troppo grandi (massimo 10 MB)");

  const mittente = await prisma.user.findUnique({ where: { id: userId } });
  if (!mittente || !mittente.isActive) throw new Error("utente non valido");

  const locale = input.locale || "it";
  const settings = await readMailSettings();
  const brand = await readMailBrand(settings.showLogo);
  const logo = logoReference(brand.logo, "cid");
  const paragrafi = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#111827">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
  try {
    await sendNow({
      to,
      subject,
      replyTo: mittente.email,
      text: `${text}\n\n— ${mittente.name} · ${config.mail.appName}`,
      html: renderMailShell({
        locale,
        recipientName: input.toName?.trim() || to,
        appName: config.mail.appName,
        brandTitle: brand.title,
        logoSrc: logo.src,
        baseUrl: settings.baseUrl,
        footer: settings.footer,
        bodyHtml: paragrafi,
        reason:
          input.reason?.trim() ||
          serverT(locale, "— ti scrive {{name}} con {{app}}.", {
            name: mittente.name,
            app: config.mail.appName,
          }),
      }),
      ...(logo.inlineImages.length ? { inlineImages: logo.inlineImages } : {}),
      ...(allegati.length
        ? {
            attachments: allegati.map((a) => ({
              filename: String(a.filename).slice(0, 150),
              contentType: String(a.contentType || "application/octet-stream"),
              content: a.content,
            })),
          }
        : {}),
    });
    return { inviata: true };
  } catch (errore) {
    return {
      inviata: false,
      motivo:
        errore instanceof Error ? errore.message : "Il server di posta ha rifiutato il messaggio.",
    };
  }
}

/** C'è un modo di spedire? Il plugin lo chiede prima di offrire il pulsante. */
export function postaAttivaPerPlugin(): boolean {
  return !config.demo && mailEnabled();
}
