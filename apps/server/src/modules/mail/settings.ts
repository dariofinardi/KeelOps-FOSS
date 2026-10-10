// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { MAIL_SETTINGS_DEFAULTS, type MailSettings } from "@kancrm/shared";
import { prisma } from "../../db";
import { config } from "../../config";
import { readBrandingLogoForEmail, type BrandingLogo } from "../branding/logo";

/**
 * Le impostazioni del template email: stanno nel database, non nel `.env`.
 *
 * La ragione è pratica — si cambiano dalla pagina di configurazione, con
 * l'anteprima davanti e il pulsante di prova accanto, senza aprire un file sul
 * server e riavviare il servizio. Nel `.env` restano solo le **credenziali**
 * del provider, che nel database non devono finire.
 *
 * L'indirizzo pubblico (`baseUrl`) si può dire in tutti e due i posti: vince
 * quello configurato qui, così lo si corregge senza toccare la macchina;
 * `APP_BASE_URL` resta come valore di partenza per un'installazione nuova.
 */
const KEYS = {
  baseUrl: "mail.baseUrl",
  intro: "mail.intro",
  footer: "mail.footer",
  showLogo: "mail.showLogo",
} as const;

/**
 * **In memoria, finché non cambiano.** Ogni email le rileggeva (e il titolo
 * del marchio con loro): una notifica a cinque persone erano quindici letture
 * delle stesse quattro righe. Si invalidano al `PUT` che le scrive e quando
 * cambia il marchio; una scadenza breve copre le scritture fatte da fuori
 * (uno script, l'altro processo di un test).
 */
const CACHE_MS = 60_000;
let cacheImpostazioni: { at: number; value: MailSettings } | null = null;
let cacheTitolo: { at: number; value: string | null } | null = null;

export function invalidateMailSettingsCache(): void {
  cacheImpostazioni = null;
  cacheTitolo = null;
}

export async function readMailSettings(): Promise<MailSettings> {
  if (cacheImpostazioni && Date.now() - cacheImpostazioni.at < CACHE_MS) {
    return cacheImpostazioni.value;
  }
  const value = await leggiImpostazioni();
  cacheImpostazioni = { at: Date.now(), value };
  return value;
}

async function leggiImpostazioni(): Promise<MailSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const value = (key: string): string | undefined => rows.find((r) => r.key === key)?.value;
  return {
    baseUrl: value(KEYS.baseUrl) ?? config.mail.baseUrl ?? MAIL_SETTINGS_DEFAULTS.baseUrl,
    intro: value(KEYS.intro) ?? MAIL_SETTINGS_DEFAULTS.intro,
    footer: value(KEYS.footer) ?? MAIL_SETTINGS_DEFAULTS.footer,
    showLogo: (value(KEYS.showLogo) ?? String(MAIL_SETTINGS_DEFAULTS.showLogo)) === "true",
  };
}

export async function writeMailSettings(patch: Partial<MailSettings>): Promise<void> {
  const entries: Array<[string, string]> = [];
  if (patch.baseUrl !== undefined) entries.push([KEYS.baseUrl, patch.baseUrl.trim()]);
  if (patch.intro !== undefined) entries.push([KEYS.intro, patch.intro.trim()]);
  if (patch.footer !== undefined) entries.push([KEYS.footer, patch.footer.trim()]);
  if (patch.showLogo !== undefined) entries.push([KEYS.showLogo, String(patch.showLogo)]);
  for (const [key, value] of entries) {
    await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  invalidateMailSettingsCache();
}

/**
 * Marchio da usare nelle email: lo stesso della pagina Aspetto. Il logo arriva
 * come **file**, non come indirizzo: nel messaggio ci va dentro (vedi
 * `logoReference`), quindi si vede anche senza che il destinatario raggiunga il
 * nostro server — e convertito in PNG, perché nella posta il formato decide se
 * l'immagine si vede o diventa un rettangolo nero.
 */
export async function readMailBrand(
  showLogo: boolean,
): Promise<{ title: string | null; logo: BrandingLogo | null }> {
  if (!cacheTitolo || Date.now() - cacheTitolo.at >= CACHE_MS) {
    cacheTitolo = {
      at: Date.now(),
      value:
        (await prisma.appSetting.findUnique({ where: { key: "branding.title" } }))?.value ?? null,
    };
  }
  const title = cacheTitolo.value;
  // Non il file originale ma la sua versione per la posta: PNG, della misura
  // giusta (vedi `readBrandingLogoForEmail`).
  return { title, logo: showLogo ? await readBrandingLogoForEmail() : null };
}
