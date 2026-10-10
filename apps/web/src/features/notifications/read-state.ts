// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import type { NotificationList } from "@kancrm/shared";

/**
 * **La spunta si vede subito, e si vede ovunque.**
 *
 * La campanella è aperta in più posti nello stesso momento — la tendina in alto,
 * la finestra della giornata, il pallino sul campanello — e tutti leggono la
 * stessa cosa. Aspettare la risposta del server per spegnere il pallino vuol
 * dire che per un istante la stessa notifica risulta letta di qua e da leggere
 * di là; e se nel frattempo il pannello si chiude (cliccare una riga apre il
 * record, e chiude la tendina), quell'istante lo si porta dietro fino al
 * prossimo aggiornamento.
 *
 * Qui si segna la lista **prima** di chiedere al server, in un punto solo: è la
 * lista che sta nella cache condivisa, quindi il segno compare in tutti i posti
 * insieme. Se poi il server rifiuta, si rimette com'era.
 *
 * Il conteggio non si ricalcola dalla lista: la lista sono le ultime cinquanta,
 * il conteggio le comprende tutte. Si scala di quante se ne sono appena lette.
 */
export function segnaLette(
  elenco: NotificationList | undefined,
  ids: string[],
  quando = new Date().toISOString(),
): NotificationList | undefined {
  if (!elenco) return elenco;
  const daLeggere = new Set(ids);
  let lette = 0;
  const notifications = elenco.notifications.map((notifica) => {
    if (!daLeggere.has(notifica.id) || notifica.readAt !== null) return notifica;
    lette += 1;
    return { ...notifica, readAt: quando };
  });
  return { notifications, unreadCount: Math.max(0, elenco.unreadCount - lette) };
}

/** Tutte lette: la lista intera, e il contatore a zero — anche ciò che non si
 *  vede, perché il comando vale su tutte, non sulle cinquanta mostrate. */
export function segnaTutteLette(
  elenco: NotificationList | undefined,
): NotificationList | undefined {
  if (!elenco) return elenco;
  const tutte = segnaLette(
    elenco,
    elenco.notifications.map((notifica) => notifica.id),
  )!;
  return { ...tutte, unreadCount: 0 };
}
