/**
 * Le scorciatoie a lettera singola valgono **solo quando non si sta scrivendo**.
 *
 * Sta qui e non dentro una pagina perché lo chiedono in due — le scorciatoie
 * globali della shell (`?`, `n`) e quelle della barra di ricerca (`/`) — e una
 * seconda copia prima o poi dimentica un caso: `n` che apre un task mentre si
 * scrive "n" in una nota è il difetto tipico di questa famiglia.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
