// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import it from "./it.json";
import en from "./en.json";
import fr from "./fr.json";
import de from "./de.json";
import es from "./es.json";
import pt from "./pt.json";

/**
 * Un catalogo è una mappa "frase italiana → traduzione". I cataloghi sono file
 * JSON (non TS) così le traduzioni si possono unire in automatico, riga per riga
 * e lingua per lingua, senza toccare il codice. L'italiano è la chiave: it.json
 * tiene solo i plurali (forme _one/_other), che l'italiano-come-chiave non dà.
 */
export type Catalog = Record<string, string>;

// Oggetto concreto (non `Record<...>`) così l'accesso `catalogs.en` è sempre
// definito: con noUncheckedIndexedAccess un indice largo darebbe `| undefined`.
export const catalogs = { it, en, fr, de, es, pt } satisfies Record<string, Catalog>;
