/*
 * Gli slot delle pagine (vedi `SlotPagine` in `slots.ts`): riesportazioni pure,
 * una per file, perché il bundler segua ognuna fino alla pagina che la usa.
 * Nella community questi file valgono `undefined`.
 */
export { AzioniProgetto } from "./commercial/pagine/progetto";
export { SezioniAspetto } from "./commercial/pagine/aspetto";
export { SezioniSistema } from "./commercial/pagine/sistema";
export {
  RigheDalleAttivita,
  useOreSuggerite,
  EsportazioniOre,
  VistaReportOre,
  ProduttivitaOre,
} from "./commercial/pagine/timesheet";
