// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { prisma } from "../../db";
import { attachmentStore } from "../attachments/store";

/**
 * Il file del logo aziendale, letto da un punto solo.
 *
 * Lo servono la rotta `/api/branding/logo` (per l'applicazione) e le email (che
 * se lo portano dentro il messaggio). Erano due modi diversi di trovare lo
 * stesso file: qui c'è quello buono, e chi lo vuole chiede il contenuto.
 */
export const BRANDING_DIR = "_branding";
export const LOGO_KEY = "branding.logo";

/** Formati accettati, con il tipo che si dichiara al destinatario. */
export const LOGO_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface BrandingLogo {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Altezza del logo nelle email. Il template lo disegna a 32 px: il triplo
 * copre gli schermi a densità alta senza spedire un'immagine da mezzo mega —
 * quella caricata è alta 512 px, e in un messaggio di posta non serve a nessuno.
 */
const EMAIL_LOGO_HEIGHT = 96;

/** Conversione fatta una volta sola: il logo cambia una volta all'anno. */
let emailLogoCache: { filename: string; logo: BrandingLogo } | null = null;

/**
 * Il logo **pronto per un'email**: sempre PNG, sempre della misura giusta.
 *
 * Il formato non è un dettaglio estetico. Il marchio caricato è un WEBP con
 * trasparenza, e i programmi di posta che l'alpha del WEBP non lo gestiscono
 * appiattiscono l'immagine sul **nero**: al posto del logo arriva un rettangolo
 * scuro (successo il 07/08/2026). Il PNG lo leggono tutti, trasparenza
 * compresa, e l'SVG — che nella posta non si disegna quasi mai — qui diventa
 * un'immagine vera.
 *
 * Dentro l'applicazione il file originale resta quello: il browser il WEBP lo
 * sa leggere benissimo, ed è più leggero. Si converte solo quello che esce.
 */
export async function readBrandingLogoForEmail(): Promise<BrandingLogo | null> {
  // Prima solo il nome, dal database (query indicizzata): se è quello già
  // convertito in cache, si evita di rileggere il file dal disco. Una notifica
  // a trenta persone lo rileggeva trenta volte — il `readFile` era il costo
  // vero, la conversione era già memoizzata.
  const filename = await readBrandingLogoName();
  if (!filename) return null;
  if (emailLogoCache?.filename === filename) return emailLogoCache.logo;

  const original = await readBrandingLogo();
  if (!original) return null;

  try {
    const sharp = (await import("sharp")).default;
    const content = await sharp(original.content)
      .resize({ height: EMAIL_LOGO_HEIGHT, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const logo: BrandingLogo = { filename: "logo.png", contentType: "image/png", content };
    emailLogoCache = { filename: original.filename, logo };
    return logo;
  } catch (error) {
    // Un logo illeggibile non deve impedire la partenza di una notifica: si
    // spedisce col nome dell'azienda al posto dell'immagine, come quando il
    // logo non c'è.
    console.warn(
      `[branding] logo non convertibile per le email (${original.filename}): ${
        error instanceof Error ? error.message : String(error)
      } — nel messaggio resta il nome`,
    );
    return null;
  }
}

/** Solo il nome del file del logo (una query, niente disco): chi vuole la cache
 *  per email controlla prima questo. */
export async function readBrandingLogoName(): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key: LOGO_KEY } }))?.value ?? null;
}

/** Il logo configurato, o `null` se non c'è (o se il file è sparito da sotto). */
export async function readBrandingLogo(): Promise<BrandingLogo | null> {
  const filename = (await prisma.appSetting.findUnique({ where: { key: LOGO_KEY } }))?.value;
  if (!filename) return null;
  const contentType = LOGO_EXTS[path.extname(filename).toLowerCase()];
  if (!contentType) return null;
  const content = await attachmentStore()
    .read(`${BRANDING_DIR}/${filename}`)
    .catch(() => null);
  return content ? { filename, contentType, content } : null;
}
