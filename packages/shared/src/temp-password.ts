// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * La password provvisoria che un amministratore consegna a una persona.
 *
 * Deve reggere due usi opposti: viaggiare per email (quindi essere robusta) e
 * poter essere **dettata al telefono** quando la posta non è configurata o non
 * arriva. Da qui le scelte:
 *  - alfabeto senza caratteri ambigui — niente `0/O`, `1/l/i`, `5/S`, `u/v`:
 *    chi la ridetta non deve indovinare;
 *  - solo minuscole e cifre, raggruppate a quattro con i trattini
 *    (`krtf-9m2q-vhx7`): un maiuscolo in mezzo è un errore di battitura in
 *    attesa di succedere, e qui la robustezza la fa la **lunghezza**, non la
 *    varietà (24 simboli ^ 12 ≈ 55 bit, per una password che vive un accesso);
 *  - `crypto.getRandomValues`, non `Math.random()`. Sta in `packages/shared`
 *    perché la usano il browser (la finestra di reset la propone già scritta) e
 *    il server (script di servizio), e deve essere la stessa in tutti e due.
 *
 * Non è la password *definitiva* di nessuno: chi la riceve deve cambiarla al
 * primo accesso (`User.mustChangePassword`).
 */

/** Alfabeto senza sosia: tolti 0 o O, 1 l i I, 5 s S, 2 z, u v. */
const ALPHABET = "abcdefghjkmnpqrtwxy34689";

const GROUP = 4;
const GROUPS = 3;

/**
 * Il byte più grande utilizzabile: 256 non è multiplo di 24, quindi prendendo
 * il resto e basta i primi simboli uscirebbero più spesso degli altri. I byte
 * oltre la soglia si scartano — costa un giro in più ogni tanto e toglie del
 * tutto lo sbilanciamento.
 */
const LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/**
 * Una password provvisoria pronta da consegnare, del tipo `krtf-9m2q-vhx7`.
 *
 * `random` esiste per i test (una sequenza prevedibile): in esecuzione vera si
 * usa sempre il generatore crittografico della piattaforma. Un `random` finto
 * che restituisse solo byte da scartare non finirebbe mai — nei test se ne dia
 * uno che almeno qualche valore buono lo produce.
 */
export function generateTempPassword(random: (length: number) => Uint8Array = cryptoBytes): string {
  const needed = GROUP * GROUPS;
  const chars: string[] = [];
  while (chars.length < needed) {
    for (const byte of random(needed)) {
      if (byte >= LIMIT) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]!);
      if (chars.length === needed) break;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i += 1) {
    groups.push(chars.slice(i * GROUP, (i + 1) * GROUP).join(""));
  }
  return groups.join("-");
}

function cryptoBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
