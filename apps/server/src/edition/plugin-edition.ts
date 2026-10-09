import { config } from "../config";
import { moduliAttivi, type Edizione, type ModuloEdizione } from "./registry";

/**
 * **I plugin e l'edizione** (08/10/2026).
 *
 * Un plugin sa in che edizione gira (`ctx.edizione`) e cosa c'è
 * (`ctx.funzioni`): i moduli dell'edizione per nome — `ticket`, `timesheet`,
 * `indice-modelli`… — più `ollama` quando il modello locale è configurato.
 * Nel manifesto può dire di cosa ha bisogno:
 *
 * - `edizione: "commerciale"`: non si monta nella community;
 * - `richiede: [...]`: non si monta se manca una di quelle funzioni;
 * - `usa: [...]`: si monta comunque, e si adatta (le porte mancanti valgono
 *   `null`). È un'informazione per chi legge, non un controllo.
 */

/** Le funzioni dell'edizione in uso, come le vede un plugin. */
export function funzioniDellEdizione(
  moduli: readonly ModuloEdizione[] = moduliAttivi(),
  ollamaConfigurato: boolean = Boolean(config.ollamaUrl),
): ReadonlySet<string> {
  const nomi = new Set(moduli.map((modulo) => modulo.nome));
  // The local model server, when configured, in every edition (decided
  // 08/10/2026: the AI queue and Ollama support are core).
  if (ollamaConfigurato) nomi.add("ollama");
  return nomi;
}

/** Quello che il manifesto dice dell'edizione. */
export interface RichiesteDelManifesto {
  edizione?: unknown;
  richiede?: unknown;
}

/**
 * Perché il plugin **non** si monta in questa edizione, o null se si monta. Il
 * testo finisce nel log e nella scheda della pagina Sistema.
 */
export function rifiutoPerEdizione(
  manifest: RichiesteDelManifesto,
  edizione: Edizione,
  funzioni: ReadonlySet<string>,
): string | null {
  if (manifest.edizione !== undefined) {
    if (manifest.edizione !== "community" && manifest.edizione !== "commerciale") {
      return `edizione "${String(manifest.edizione)}" non valida: community o commerciale`;
    }
    if (manifest.edizione === "commerciale" && edizione !== "commerciale") {
      return "plugin dell'edizione commerciale";
    }
  }
  if (manifest.richiede !== undefined) {
    if (!Array.isArray(manifest.richiede)) return "richiede: serve un elenco di funzioni";
    const mancanti = manifest.richiede.map(String).filter((nome) => !funzioni.has(nome));
    if (mancanti.length > 0)
      return `richiede funzioni assenti in questa edizione: ${mancanti.join(", ")}`;
  }
  return null;
}
