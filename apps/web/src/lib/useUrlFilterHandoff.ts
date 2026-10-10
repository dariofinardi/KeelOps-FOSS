// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Consegna di filtri da una pagina all'altra tramite l'indirizzo.
 *
 * Chi arriva da un collegamento ("le 5 offerte di Acme") deve trovare la
 * lista già filtrata; da quel momento in poi però il filtro è suo — modificabile
 * e azzerabile come gli altri. Quindi i parametri si applicano **una volta
 * sola** alle preferenze e poi spariscono dall'URL: senza toglierli, ricaricare
 * la pagina rimetterebbe il filtro che l'utente aveva appena rimosso.
 *
 * Era scritto a mano nello Scadenzario; ora lo usano anche Offerte e Progetti.
 */
export function useUrlFilterHandoff(
  names: readonly string[],
  apply: (values: Record<string, string>) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const present = names
    .map((name) => [name, searchParams.get(name)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  // Firma stabile: l'effetto riparte solo se cambiano davvero i parametri, non a
  // ogni render (l'array `present` è nuovo ogni volta).
  const signature = present.map(([name, value]) => `${name}=${value}`).join("&");

  useEffect(() => {
    if (signature === "") return;
    apply(Object.fromEntries(new URLSearchParams(signature)));
    for (const name of names) searchParams.delete(name);
    setSearchParams(searchParams, { replace: true });
    // `apply` cambia a ogni render nei chiamanti: la dipendenza vera è la firma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
