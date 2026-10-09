import { UserRole } from "@kancrm/shared";
import { moduliAttivi, politicheDei } from "./registry";

/**
 * **Cosa può fare un ruolo che non è del nucleo** (08/10/2026). Il nucleo
 * conosce due ruoli, ADMIN e MEMBER, senza restrizioni di percorso. Gli altri —
 * i clienti del portale, i monitor vendite — li porta un modulo dell'edizione,
 * con l'elenco dei percorsi API in cui possono entrare.
 *
 * Un ruolo che nessun modulo dichiara **non entra**: è il caso di un'edizione
 * community accesa su un database commerciale. Prima l'unico freno a quei ruoli
 * stava nel codice commerciale; tolto quello, un cliente del portale sarebbe
 * diventato un utente interno.
 */
export interface PoliticaRuolo {
  /** Prefissi dei percorsi ammessi, con qualunque metodo. */
  percorsi: readonly string[];
  /** Prefissi in più ammessi solo in lettura (GET). */
  inLettura?: readonly string[];
  /** Il messaggio del 403 fuori perimetro. */
  messaggio: string;
  /**
   * **Legge, non scarica** (il monitor vendite): i file si aprono solo nel
   * lettore interno, i link Google nella loro anteprima, e un link a un task
   * di questa istanza non porta da nessuna parte — i task sono lavoro interno.
   */
  allegatiInSolaLettura?: boolean;
}

const NUCLEO: ReadonlySet<string> = new Set([UserRole.ADMIN, UserRole.MEMBER]);
let impostate: Map<string, PoliticaRuolo> | null = null;

/**
 * Le politiche in vigore: quelle impostate da `buildApp`, o — per chi usa i
 * servizi senza avviare l'applicazione (script, test di unità) — quelle dei
 * moduli dell'edizione configurata.
 */
function politiche(): Map<string, PoliticaRuolo> {
  return (impostate ??= new Map(politicheDei(moduliAttivi())));
}

/** Le politiche dei moduli attivi; le chiama `buildApp` prima di registrare le rotte. */
export function impostaPoliticheRuoli(nuove: Iterable<[string, PoliticaRuolo]>): void {
  impostate = new Map(nuove);
}

/** Un ruolo del nucleo: ADMIN o MEMBER, che lavorano dentro e non hanno perimetri di percorso. */
export function ruoloDelNucleo(ruolo: string): boolean {
  return NUCLEO.has(ruolo);
}

/** Il ruolo legge gli allegati senza scaricarli (vedi `PoliticaRuolo`). */
export function allegatiInSolaLettura(ruolo: string): boolean {
  return politiche().get(ruolo)?.allegatiInSolaLettura === true;
}

/** Un ruolo che questa edizione sa servire: del nucleo o dichiarato da un modulo. */
export function ruoloPrevisto(ruolo: string): boolean {
  return NUCLEO.has(ruolo) || politiche().has(ruolo);
}

/**
 * Il controllo del guardiano: null se la richiesta può passare, altrimenti il
 * messaggio del rifiuto. I ruoli del nucleo passano sempre (i permessi veri li
 * decidono le singole rotte); quelli di un modulo solo nei loro percorsi; gli
 * altri da nessuna parte, tranne l'uscita.
 */
export function rifiutoPerRuolo(ruolo: string, metodo: string, percorso: string): string | null {
  if (NUCLEO.has(ruolo)) return null;
  const politica = politiche().get(ruolo);
  if (!politica) {
    return percorso === "/api/auth/logout"
      ? null
      : "Questo tipo di utente non è previsto in questa edizione";
  }
  const ammessi = [...politica.percorsi, ...(metodo === "GET" ? (politica.inLettura ?? []) : [])];
  return ammessi.some((prefisso) => percorso.startsWith(prefisso)) ? null : politica.messaggio;
}
