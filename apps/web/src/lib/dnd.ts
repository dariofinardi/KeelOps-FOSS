// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";

/**
 * Su quale colonna si sta lasciando la card: **conta dove punta il dito**, non
 * dove galleggia il rettangolo trascinato.
 *
 * È la correzione di un difetto vero (07/08/2026): senza questa regola dnd-kit
 * sceglie la colonna che ha la maggiore *sovrapposizione* con la card
 * trascinata. Una card larga sopra colonne strette copre due o tre colonne
 * insieme, e vince quella con più area — che spesso non è quella sotto il
 * puntatore. Si vedeva l'evidenziazione accendersi su una colonna mentre la
 * freccia era su un'altra, e il task finiva nello stato sbagliato: un errore
 * silenzioso, perché sembrava di aver sbagliato mira.
 *
 * Il rettangolo resta come riserva per i casi in cui il puntatore non è dentro
 * nessuna colonna — trascinando sopra l'intestazione, o fuori dalla bacheca —
 * altrimenti in quel momento non ci sarebbe nessuna destinazione e la card
 * tornerebbe indietro senza motivo apparente.
 */
export const pointerFirstCollision: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};
