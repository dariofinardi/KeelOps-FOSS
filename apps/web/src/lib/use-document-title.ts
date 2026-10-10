// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";

/**
 * **Il titolo della scheda del browser.**
 *
 * Senza, ogni scheda si chiama «KeelOps — Gestionale interno»: con tre schede
 * aperte — un progetto, il timesheet, un'offerta — sono indistinguibili, e la
 * cronologia del browser è una lista di voci tutte uguali (22/08/2026).
 *
 * Il formato è `«cosa» — KeelOps`: prima la parte che cambia, perché è quella
 * che si legge su una linguetta larga tre dita.
 *
 * **Si comporta da pila**: al montaggio ricorda il titolo che c'era e allo
 * smontaggio lo rimette. Così un pannello di dettaglio sopra una pagina mette
 * il nome del record, e alla chiusura la scheda torna a chiamarsi come la
 * pagina — senza che nessuno dei due sappia dell'altro.
 *
 * `null`/vuoto = non toccare niente: chi ha il dato in caricamento chiama
 * l'hook lo stesso (le regole dei hook non ammettono il forse) e il titolo
 * arriva quando arriva il record.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const pulito = title?.trim();
    if (!pulito) return;
    const prima = document.title;
    document.title = `${pulito} — KeelOps`;
    return () => {
      document.title = prima;
    };
  }, [title]);
}
