// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { prisma } from "../../db";

/**
 * L'interruttore dei calendari sottoscrivibili, in mano all'amministratore.
 *
 * Un feed iCal è l'unico punto dell'applicazione che si legge **senza sessione**:
 * il token nell'indirizzo è tutta l'autenticazione che i client di calendario
 * sanno portare, e quell'indirizzo finisce sui server di Google, nelle
 * configurazioni dei telefoni, nei backup di chi lo incolla. È una superficie
 * che chi amministra deve poter aprire — e richiudere — di sua volontà.
 *
 * Perciò **nasce spenta**: si accende sapendo cosa si sta accendendo, dalla
 * pagina Email e Calendari. Spegnendola i link smettono di rispondere, non solo
 * di crearsi: un interruttore che lascia vive le porte già aperte non è un
 * interruttore.
 */
const KEY = "calendar.feedsEnabled";

export async function calendarFeedsEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return row?.value === "true";
}

export async function setCalendarFeedsEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    update: { value: String(enabled) },
    create: { key: KEY, value: String(enabled) },
  });
}
