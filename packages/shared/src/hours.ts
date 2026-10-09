/**
 * Ore a timesheet: come si scrivono e come si leggono.
 *
 * Si registrano **centesimi di ora**: 4,5 sono quattro ore e mezza, 4,2 quattro
 * ore e dodici minuti, 0,75 tre quarti d'ora. Due decimali perché è la finezza
 * con cui si è sempre lavorato — lo storico è pieno di quarti d'ora — e perché
 * quello che si legge in una casella dev'essere anche riscrivibile: con un solo
 * decimale, ritoccare uno 0,75 lo avrebbe trasformato in 0,8.
 *
 * Chi scrive in italiano usa la virgola, chi arriva dalla tastiera numerica il
 * punto: valgono entrambi, e quello che si rilegge è sempre in italiano.
 */

/** Ore massime registrabili in un giorno da una persona. */
export const MAX_HOURS_PER_DAY = 24;

/**
 * Arrotonda al centesimo di ora. Il termine `Number.EPSILON` evita che 4,155
 * diventi 4,15 per via di come i decimali stanno in binario.
 */
export function roundHours(hours: number): number {
  return Math.round((hours + Number.EPSILON) * 100) / 100;
}

/**
 * Interpreta quello che è stato digitato: "4,5" e "4.5" sono la stessa cosa,
 * "4" resta 4, gli spazi non contano. Stringa vuota = zero, che a timesheet
 * significa "cancella la registrazione".
 *
 * Restituisce `null` se non è un numero di ore scrivibile — così chi chiama
 * distingue "non ho capito" da "ha scritto zero" e non salva un valore a caso.
 */
export function parseHours(input: string): number | null {
  const cleaned = input.trim().replace(",", ".");
  if (cleaned === "") return 0;
  // Cifre con al più un separatore decimale: niente segni, niente esponenti.
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > MAX_HOURS_PER_DAY) return null;
  return roundHours(value);
}

/**
 * Come si scrive un monte ore: "4,5", "8", "0,2". Lo zero diventa stringa vuota
 * perché nella griglia una casella vuota dice "niente ore" meglio di uno zero.
 *
 * Mostra quello che è registrato fino al centesimo, senza zeri inutili: "8" e
 * non "8,00". Così i quarti d'ora dello storico (0,75 · 2,25 · 4,25) si leggono
 * come sono, e i totali di colonna — sommati sui valori veri — tornano con le
 * celle.
 */
export function formatHours(hours: number): string {
  if (hours === 0) return "";
  return hours.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}
