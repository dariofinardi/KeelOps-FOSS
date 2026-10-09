import type { FastifyInstance } from "fastify";
import type { CurrentUser, Dashboard, NotificationType } from "@kancrm/shared";
import type nodeCron from "node-cron";
import { MODULI_COMMERCIALI } from "../commercial";
import { config } from "../config";
import type { User } from "../generated/prisma/client";
import type { PoliticaRuolo } from "./roles";
import type { RegoleAccessoTask } from "../modules/tasks/access-rules";
import type { AgganciTask } from "../modules/tasks/lifecycle-hooks";
import type { DialettoImport } from "../modules/imports/dialects";

export type Edizione = "community" | "commerciale";

/** Quello che un modulo dice dopo aver preso in mano un'offerta vinta. */
export interface EsitoOffertaVinta {
  /** Riempito solo se la lettura non è ripartita perché c'era già. */
  analysisNotice: { fattaIl: string; applicata: boolean } | null;
  analysisState: "in-coda" | "senza-modello" | "senza-allegati" | "gia-fatta" | null;
}

/** Quello che serve a un modulo per pianificare i suoi lavori. */
export interface ContestoJob {
  cron: typeof nodeCron;
  app: FastifyInstance;
  /** La timezone aziendale, per ogni `cron.schedule`. */
  tz: { timezone: string };
}

/**
 * **Un modulo di un'edizione** (08/10/2026): ciò che il nucleo carica solo se
 * l'edizione lo prevede. Le rotte si registrano in `buildApp`, i lavori
 * pianificati in `index.ts`. Il nucleo non importa i moduli commerciali uno per
 * uno: li riceve da qui, e la community riceve un elenco vuoto.
 */
export interface ModuloEdizione {
  /** Nome breve, per log e test: `ticket`, `timesheet`… */
  nome: string;
  rotte?: (app: FastifyInstance) => void;
  job?: (contesto: ContestoJob) => void;
  /** I ruoli che il modulo porta, con i percorsi in cui possono entrare (vedi roles.ts). */
  ruoli?: Readonly<Record<string, PoliticaRuolo>>;
  /** Le regole di accesso ai task che il modulo porta (vedi tasks/access-rules.ts). */
  accessoTask?: RegoleAccessoTask;
  /** Gli agganci del modulo nel ciclo di vita dei task (vedi tasks/lifecycle-hooks.ts). */
  agganciTask?: AgganciTask;
  /**
   * I campi che il modulo riempie nell'utente corrente (i flag dei suoi
   * permessi), sull'utente efficace. Il nucleo li tiene a `false`.
   */
  utenteCorrente?: (user: User) => Partial<CurrentUser> | Promise<Partial<CurrentUser>>;
  /** Le sezioni che il modulo riempie in «La mia giornata». Il nucleo le lascia vuote. */
  dashboard?: (user: User) => Promise<Partial<Dashboard>>;
  /** I tipi di notifica che il modulo produce (vedi notification-types.ts). */
  tipiNotifica?: readonly NotificationType[];
  /**
   * Un allegato che nessun task collegato lascia aprire può essere del modulo
   * (le note di rilascio in PDF del portale): true lo lascia leggere.
   */
  leggeAllegato?: (user: User, attachmentId: string) => Promise<boolean>;
  /**
   * L'offerta è appena passata in fase vinta: il modulo la prende in mano al
   * posto del nucleo, che altrimenti crea il task di fatturazione.
   */
  offertaVinta?: (dealId: string, user: User) => Promise<EsitoOffertaVinta>;
  /**
   * Le porte che il modulo presta ai plugin (`ctx.timesheet`…). Un plugin la
   * riceve se la chiede nel manifesto **e** il modulo c'è; altrimenti `null`.
   */
  portePlugin?: Readonly<Record<string, unknown>>;
  /** Extra Content-Security-Policy sources the module's pages load from (production only). */
  csp?: Partial<Record<"script" | "img" | "connect" | "frame", readonly string[]>>;
  /** Spreadsheet dialects the Excel import understands (modules/imports/dialects.ts). */
  dialettiImport?: readonly DialettoImport[];
}

/** La porta `nome` dei moduli attivi, o null se nessun modulo la presta. */
export function portaPlugin(nome: string, moduli = moduliAttivi()): unknown {
  return moduli.find((modulo) => modulo.portePlugin?.[nome])?.portePlugin?.[nome] ?? null;
}

/** Le politiche dei ruoli dichiarate dai moduli di un elenco. */
export function politicheDei(moduli: readonly ModuloEdizione[]): Array<[string, PoliticaRuolo]> {
  return moduli.flatMap((modulo) => Object.entries(modulo.ruoli ?? {}));
}

/**
 * **The edition in force**: the configured one, except that a build without
 * commercial modules — the community export, where `commercial/` is a stub —
 * is the community whatever `KEELOPS_EDITION` says. In the full build the list
 * is never empty, and this is `config.edizione` as before.
 */
export function edizioneInVigore(): Edizione {
  return MODULI_COMMERCIALI.length > 0 ? config.edizione : "community";
}

/** Whether the module `nome` is part of the edition in force. */
export function haModulo(nome: string): boolean {
  return moduliAttivi().some((modulo) => modulo.nome === nome);
}

/** I moduli dell'edizione in uso (o di quella chiesta, nei test). */
export function moduliAttivi(edizione: Edizione = edizioneInVigore()): readonly ModuloEdizione[] {
  return edizione === "commerciale" ? MODULI_COMMERCIALI : [];
}
