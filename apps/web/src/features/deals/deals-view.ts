import type { DealValueUnit } from "@kancrm/shared";

export type DealsViewMode = "table" | "pipeline" | "forecast";

/**
 * Un valore dell'elenco offerte, nell'unità dichiarata dalla risposta: euro per
 * chi lavora il CRM, giornate per i gruppi che vedono la pipeline in "Giornate".
 * La conversione l'ha già fatta il server — qui si sceglie solo come scriverlo.
 */
export function formatDealValue(
  value: number | null,
  unit: DealValueUnit,
  money: { format(value: number): string },
): string {
  if (value === null) return "—";
  return unit === "DAYS"
    ? `${value.toLocaleString("it-IT", { useGrouping: "always" })} gg`
    : money.format(value);
}

/**
 * Se la vista corrente deve chiedere al server anche le offerte concluse.
 *
 * Solo la **tabella** lascia scegliere ("Mostra vinte/perse"): è un elenco, e chi
 * lavora vuole di norma vedere le trattative ancora vive. Kanban e Forecast le
 * vogliono sempre tutte — il kanban ha le colonne Vinta e Persa, e la previsione
 * senza le concluse mostrerebbe un mese svuotato proprio da quello che ci è
 * entrato davvero (le vinte pesano il 100%).
 */
export function includeClosedForView(view: DealsViewMode, tablePreference: boolean): boolean {
  return view === "table" ? tablePreference : true;
}

/**
 * Data da mostrare in elenco: quella della **chiusura effettiva** se la trattativa
 * è conclusa, altrimenti la prevista. È la stessa che usa la previsione, e serve
 * perché i due schermi si possano confrontare: un affare chiuso a luglio deve
 * leggersi luglio anche nella riga, o i conti del mese sembrano sbagliati.
 */
export function closeDateFields(deal: {
  closedAt: string | null;
  expectedCloseDate: string | null;
}): { date: string | null; closed: boolean } {
  return deal.closedAt
    ? { date: deal.closedAt, closed: true }
    : { date: deal.expectedCloseDate, closed: false };
}

/**
 * Probabilità da mostrare in elenco. Su una trattativa conclusa la percentuale
 * dichiarata non vuol più dire niente — una vinta all'80% è vinta al 100% — e
 * lasciarla scritta faceva sembrare sbagliati i conti della previsione, che la
 * ignorano.
 */
export function displayProbability(deal: {
  probability: number | null;
  stage: { isWon: boolean; isLost: boolean };
}): { percent: number | null; declared: number | null } {
  if (deal.stage.isWon) return { percent: 100, declared: deal.probability };
  if (deal.stage.isLost) return { percent: 0, declared: deal.probability };
  return { percent: deal.probability, declared: null };
}
