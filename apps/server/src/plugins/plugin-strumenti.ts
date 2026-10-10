// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { UserRole } from "@kancrm/shared";
import { prisma } from "../db";
import { isElevated } from "../modules/auth/elevation";
import { funzioniDellEdizione } from "../edition/plugin-edition";
import { pluginDisattivato } from "./plugin-stato";

/**
 * **Il tunnel fra plugin** (23/09/2026): un plugin dichiara degli strumenti —
 * nome, descrizione, parametri, e la funzione che risponde per conto di una
 * persona — e un altro plugin, che lo chiede nel manifesto con il permesso
 * `plugins:strumenti`, li trova qui. È il modo in cui il connettore MCP pro
 * offre agli assistenti le schede di QABox senza sapere com'è fatto QABox.
 *
 * Tre regole, ed è per queste che il tunnel passa dal core e non va da un
 * plugin all'altro per conto suo:
 *
 * - **si dichiara, non si scansiona**: di un plugin si vede solo quello che
 *   lui ha scelto di offrire. Le sue rotte e le sue tabelle restano sue, e i
 *   suoi controlli di accesso (i settori di QABox) restano dentro la funzione;
 * - **l'identità la mette il core**: chi chiama passa l'id di una persona, e il
 *   plugin che risponde riceve l'utente letto qui dal database — attivo e
 *   interno, o niente. Nessun plugin può presentarsi a un altro con un utente
 *   inventato;
 * - **un plugin spento sparisce anche da qui**, al momento: i suoi strumenti
 *   non si elencano e una chiamata già partita viene rifiutata.
 *
 * Il registro si legge **alla chiamata**, non all'avvio: i plugin si caricano
 * in fila nell'ordine di `PLUGINS`, e chi chiede può essere caricato prima di
 * chi offre.
 */

/** L'utente come lo vedono i plugin: lo stesso di `ctx.sessionUser`. */
export interface UtenteDelPlugin {
  id: string;
  name: string;
  role: string;
  elevated: boolean;
  canViewAllTimesheets: boolean;
  locale: string | null;
  /**
   * Le funzioni dell'edizione (08/10/2026, come `ctx.funzioni`): viaggiano con
   * l'utente perché le regole dell'SDK che lo ricevono — il perimetro dei task
   * — sappiano se i ticket esistono.
   */
  funzioni: ReadonlySet<string>;
}

/** Da un utente del core alla forma che ricevono i plugin; gli esterni restano fuori. */
export function utenteDelPlugin(user: {
  id: string;
  name: string;
  nickName: string | null;
  role: string;
  adminUntil: Date | null;
  canViewAllTimesheets: boolean;
  locale: string | null;
  isActive?: boolean;
}): UtenteDelPlugin | null {
  // gli utenti esterni (portale clienti, monitor venditori) restano fuori dai plugin
  if (user.isActive === false) return null;
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.MEMBER) return null;
  return {
    id: user.id,
    name: user.nickName || user.name,
    role: user.role,
    // il «super admin»: un amministratore che si è elevato (vedi auth/elevation)
    elevated: isElevated(user),
    canViewAllTimesheets: user.canViewAllTimesheets,
    locale: user.locale,
    funzioni: funzioniDellEdizione(),
  };
}

/** Lo stesso utente, cercato per id: è la persona per cui uno strumento risponde. */
export async function utentePerPlugin(userId: string): Promise<UtenteDelPlugin | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? utenteDelPlugin(user) : null;
}

/** Uno strumento come lo dichiara il plugin che lo offre (`create()` → `strumenti`). */
export interface StrumentoDichiarato {
  nome: string;
  descrizione: string;
  /** JSON Schema dei parametri (`{ type: "object", properties, required }`). */
  parametri?: Record<string, unknown>;
  esegui: (utente: UtenteDelPlugin, parametri: Record<string, unknown>) => Promise<unknown>;
}

/** Uno strumento come lo riceve chi lo usa: col nome prefissato e l'identità nelle mani del core. */
export interface StrumentoDiPlugin {
  plugin: string;
  titolo: string;
  versione: string;
  nome: string;
  descrizione: string;
  parametri: Record<string, unknown>;
  esegui: (userId: string, parametri?: Record<string, unknown>) => Promise<unknown>;
}

interface Offerta {
  plugin: string;
  prefisso: string;
  titolo: string;
  versione: string;
  strumenti: StrumentoDichiarato[];
}

const offerte = new Map<string, Offerta>();
const NOME = /^[a-z][a-z0-9_]{0,48}$/;

/**
 * Registra gli strumenti di un plugin appena caricato. Quelli scritti male si
 * scartano uno per uno, e lo si dice: uno sbagliato non spegne gli altri.
 */
export function registraStrumenti(
  plugin: string,
  info: { prefisso: string; titolo: string; versione: string },
  dichiarati: unknown,
  avvisa: (messaggio: string) => void,
): void {
  if (dichiarati === undefined) return;
  if (!Array.isArray(dichiarati)) {
    avvisa(`plugin "${plugin}": strumenti dev'essere un elenco, lo ignoro`);
    return;
  }
  const validi: StrumentoDichiarato[] = [];
  for (const s of dichiarati as Array<Partial<StrumentoDichiarato>>) {
    if (!s || typeof s.nome !== "string" || !NOME.test(s.nome) || typeof s.esegui !== "function") {
      avvisa(`plugin "${plugin}": strumento "${String(s?.nome)}" senza nome valido o senza esegui(), lo salto`);
      continue;
    }
    validi.push({
      nome: s.nome,
      descrizione: String(s.descrizione ?? ""),
      parametri: s.parametri,
      esegui: s.esegui,
    });
  }
  offerte.set(plugin, { plugin, ...info, strumenti: validi });
}

/** Solo per i test. */
export function dimenticaStrumenti(): void {
  offerte.clear();
}

/**
 * Gli strumenti offerti dagli **altri** plugin accesi, per chi li chiede. Il
 * nome esce col prefisso del plugin (`qabox_cruscotto`): due plugin con uno
 * strumento omonimo non si pestano i piedi, e l'assistente vede da dove viene.
 */
export function strumentiPer(chiede: string): StrumentoDiPlugin[] {
  const out: StrumentoDiPlugin[] = [];
  for (const o of offerte.values()) {
    if (o.plugin === chiede || pluginDisattivato(o.plugin)) continue;
    for (const s of o.strumenti) {
      out.push({
        plugin: o.plugin,
        titolo: o.titolo,
        versione: o.versione,
        nome: `${o.prefisso}_${s.nome}`,
        descrizione: s.descrizione,
        parametri: s.parametri ?? { type: "object", properties: {} },
        esegui: async (userId, parametri = {}) => {
          if (pluginDisattivato(o.plugin)) throw new Error(`il plugin ${o.titolo} è disattivato`);
          const utente = await utentePerPlugin(userId);
          if (!utente) throw new Error("utente non valido per gli strumenti dei plugin");
          return s.esegui(utente, parametri);
        },
      });
    }
  }
  return out;
}
