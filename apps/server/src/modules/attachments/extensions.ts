import { parseExtraExtensions } from "@kancrm/shared";
import { prisma } from "../../db";

/**
 * **Le estensioni ammesse in più**, oltre a quelle di casa.
 *
 * Sta in banca dati e non in un file, per tre ragioni pratiche: un file dentro
 * `app/` lo cancella il deploy (`rsync --delete`), uno fuori va creato a mano su
 * ogni macchina e non entra nel backup notturno, e comunque **anche il browser**
 * deve conoscere la lista — quindi un endpoint servirebbe lo stesso. Qui invece
 * si cambia dalla pagina Sistema, ha effetto subito e viaggia con i backup.
 *
 * Si legge spesso (a ogni caricamento e a ogni `/me`) e cambia quasi mai: si
 * tiene da parte per un minuto.
 */

export const EXTRA_EXTENSIONS_KEY = "attachments.extraExtensions";

const VALIDA_MS = 60_000;
let cache: { valore: string[]; scade: number } | null = null;

export async function extraAttachmentExtensions(): Promise<string[]> {
  if (cache && Date.now() < cache.scade) return cache.valore;
  const riga = await prisma.appSetting.findUnique({ where: { key: EXTRA_EXTENSIONS_KEY } });
  const valore = parseExtraExtensions(riga?.value);
  cache = { valore, scade: Date.now() + VALIDA_MS };
  return valore;
}

/** Scrive la configurazione e la rende valida **adesso**, non fra un minuto. */
export async function setExtraAttachmentExtensions(grezzo: string): Promise<string[]> {
  const valore = parseExtraExtensions(grezzo);
  await prisma.appSetting.upsert({
    where: { key: EXTRA_EXTENSIONS_KEY },
    update: { value: valore.join(" ") },
    create: { key: EXTRA_EXTENSIONS_KEY, value: valore.join(" ") },
  });
  cache = { valore, scade: Date.now() + VALIDA_MS };
  return valore;
}

/** Solo per i test: dimentica quello che ha in mano. */
export function resetExtensionsCache(): void {
  cache = null;
}
