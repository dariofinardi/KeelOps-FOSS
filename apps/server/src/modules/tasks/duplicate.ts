import { SERVER_LOCALES, serverT } from "../../i18n";

/**
 * **Il titolo di una copia.**
 *
 * Duplicare un task lascia due righe con lo stesso nome, e a quel punto non si
 * sa piu quale sia quale: il titolo porta il numero della copia — "Verifica
 * bilancio (copia 1)" — e la copia successiva prende il 2.
 *
 * Il suffisso è **tradotto nella lingua di chi duplica**: finisce in un campo
 * che resta scritto, e un utente francese che vede "(copia 1)" ha una parola
 * italiana nel proprio archivio. Il prezzo è che il numero successivo va
 * riconosciuto in una lingua qualunque — la copia di ieri può averla fatta un
 * collega con l'interfaccia in inglese — e per questo i modelli si costruiscono
 * da tutti i cataloghi, non solo dal proprio.
 */

/** La chiave i18n del suffisso. L'italiano è la chiave, come ovunque. */
export const COPY_KEY = "(copia {{n}})";

/** Limite del titolo di un task, come nello schema di creazione. */
const MAX_TITLE = 200;

const SEGNAPOSTO = "@@N@@";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Un modello per lingua, con il numero come gruppo: riconosce "(copia 3)",
 * "(copy 3)", "(copie 3)"... in fondo a un titolo.
 *
 * Si traduce con un segnaposto, si protegge il risultato, e solo dopo il
 * segnaposto diventa il gruppo del numero: così il modello segue la traduzione
 * anche se un giorno cambia.
 */
const PATTERNS = SERVER_LOCALES.map((locale) => {
  const modello = escapeRegExp(serverT(locale, COPY_KEY, { n: SEGNAPOSTO }));
  return new RegExp(`\\s*${modello.replace(SEGNAPOSTO, "(\\d+)")}$`);
});

/** Il titolo senza il suo suffisso di copia, in qualunque lingua sia scritto. */
export function stripCopySuffix(title: string): string {
  for (const pattern of PATTERNS) {
    const senza = title.replace(pattern, "");
    if (senza !== title) return senza.trimEnd();
  }
  return title;
}

/** Il numero di copia scritto in fondo, o `null` se non ce n'è uno. */
export function copyNumber(title: string): number | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(title);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Il titolo della prossima copia, dato l'originale e i titoli già presenti
 * **nello stesso contesto**.
 *
 * Si riparte dal titolo base: duplicare una copia dà "(copia 2)", non
 * "(copia 1) (copia 1)". E il numero è il primo dopo il più alto già usato, non
 * il conteggio delle copie: cancellandone una di mezzo, la prossima non deve
 * riprendere un nome che qualcuno ha ancora sotto gli occhi.
 */
export function nextCopyTitle(original: string, esistenti: string[], locale: string): string {
  const base = stripCopySuffix(original);
  let massimo = 0;
  for (const titolo of esistenti) {
    if (stripCopySuffix(titolo) !== base) continue;
    massimo = Math.max(massimo, copyNumber(titolo) ?? 0);
  }
  const suffisso = serverT(locale, COPY_KEY, { n: massimo + 1 });
  // Il titolo ha un limite: si accorcia la base, non il suffisso — senza il
  // numero due copie tornerebbero indistinguibili.
  const spazio = MAX_TITLE - suffisso.length - 1;
  const testa = base.length > spazio ? base.slice(0, spazio).trimEnd() : base;
  return `${testa} ${suffisso}`;
}
