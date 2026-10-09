/**
 * **Statistiche di posizione, senza mentire sul vuoto.**
 *
 * Le due copie precedenti avevano già divergito proprio qui: una rispondeva `0`
 * su un elenco vuoto, l'altra `null`. Ma zero è un valore — «la mediana delle
 * ore è zero» dice che nessuno ha lavorato, non che non ci sono dati — quindi
 * la risposta onesta per il vuoto è `null`, e chi ha un default sensato se lo
 * mette con `?? 0` dove decide di mostrare qualcosa.
 */

/** Mediana: sulle distribuzioni storte (le ore lo sono) la media mente. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** Quantile grezzo, per dire un intervallo invece di un numero solo. */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}
