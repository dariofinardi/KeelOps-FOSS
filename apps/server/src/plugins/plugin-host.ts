import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import {
  NAV_AREA_KEYS,
  PLUGIN_UI_SECTIONS,
  UserRole,
  type PluginScheda,
  type PluginUiEntry,
  type PluginUiSection,
} from "@kancrm/shared";
import { config } from "../config";
import { connessioneSolaLettura, databasePath, motore, prismaRaw } from "../db";
import { SESSION_COOKIE, findSessionUser } from "../modules/auth/session";
import { leggiPubblici } from "./plugin-public";
import { caricaStatoPlugin, pluginDisattivato } from "./plugin-stato";
import { localeFromRequest, serverT } from "../i18n";
import { leggiAllegatoPerPlugin, puoModificareTaskPerPlugin, scriviAllegatoPerPlugin } from "./plugin-attachments";
import { creaTaskPerPlugin, leggiTaskPerPlugin, leggiTaskPerPluginMolti } from "./plugin-tasks";
import { edizioneInVigore, haModulo, portaPlugin } from "../edition/registry";
import { funzioniDellEdizione, rifiutoPerEdizione } from "../edition/plugin-edition";
import { inviaEmailPerPlugin, postaAttivaPerPlugin } from "./plugin-mail";
import { registraStrumenti, strumentiPer, utenteDelPlugin } from "./plugin-strumenti";
import { pushSse } from "../modules/notifications/service";
import {
  assicuraGruppoPerPlugin,
  leggiGruppoDelPlugin,
  membriGruppoDelPlugin,
  utenteNelGruppoDelPlugin,
} from "./plugin-groups";

/**
 * Il porta-plugin, seconda forma: i plugin sono CARICATI DENTRO il processo del
 * core (side-loaded), non processi da inoltrare. Le "API" sono chiamate di
 * funzione locali: il core presta ai plugin la SUA autenticazione
 * (`findSessionUser`, niente token né copie del cookie) e il suo database.
 * La sicurezza sta nel codice — le rotte dei plugin applicano il perimetro
 * dell'utente — non nell'infrastruttura. Le API HTTP esistenti (l'integrazione
 * osTicket) non c'entrano e non cambiano.
 *
 * Ogni plugin espone `plugins/<nome>/plugin.mjs` con `create(ctx)` → rotte in
 * stile tabella + cartella statica (contratto in `plugins/LEGGIMI.md`); il
 * dispatcher è quello condiviso di `keelops-sdk/http.mjs`, lo stesso del modo
 * autonomo usato in sviluppo: un solo instradamento, impossibile che diverga.
 *
 * **Dal 05/09/2026 un plugin può possedere tabelle.** Dichiara un `nick` nel
 * manifesto e da lì in poi è responsabile delle tabelle `plugin_<nick>_…`: le
 * crea, le migra, le tiene. Il core gli chiede tre cose, qui sotto in
 * `preparaTabelle`: che esista `plugin_<nick>_config` con le due versioni, che
 * la struttura in tabella non sia più avanti del codice, e che una migrazione
 * lasci la versione dove il codice se l'aspetta. Chi non risponde non viene
 * montato — il plugin, mai il core.
 *
 * Le risposte dei plugin passano da `reply.hijack()` sul flusso grezzo: la CSP
 * del core non si applica alle loro pagine (hanno le proprie regole) e i corpi
 * POST arrivano intatti ai loro gestori OAuth. Un errore in fase di caricamento
 * disattiva il singolo plugin, mai il core.
 */

/** `TasksMap,mcp` → nomi; le voci malformate si scartano a voce alta. */
export function parsePluginNames(spec: string): string[] {
  const names: string[] = [];
  for (const entry of spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!/^[A-Za-z0-9_-]+$/.test(entry)) {
      // eslint-disable-next-line no-console
      console.warn(`PLUGINS: voce ignorata perché malformata: "${entry}" (atteso solo il nome)`);
      continue;
    }
    names.push(entry);
  }
  return names;
}

/** L'utente della sessione KeelOps, nella forma che i plugin si aspettano. */
async function pluginSessionUser(req: IncomingMessage) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((c) => {
      const eq = c.indexOf("=");
      return eq < 0
        ? [c.trim(), ""]
        : [c.slice(0, eq).trim(), decodeURIComponent(c.slice(eq + 1).trim())];
    }),
  );
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const user = await findSessionUser(token);
  // la stessa forma che riceve chi risponde a uno strumento (plugin-strumenti.ts)
  return user ? utenteDelPlugin(user) : null;
}

type Dispatch = (req: IncomingMessage, res: NodeJS.WritableStream, path: string) => Promise<void>;

/**
 * I plugin vivono FUORI dal grafo dei bundler: si importano col motore ESM di
 * Node. Sotto vite-node (vitest) questo non funziona — ed è il motivo per cui
 * `test/plugin-host.test.ts` avvia il server vero come sottoprocesso invece di
 * usare `buildApp` in-process.
 */
const importOutside = (p: string) =>
  import(/* @vite-ignore */ p) as Promise<Record<string, CallableFunction>>;

/** Il manifesto, per quello che il core ne legge. */
interface Manifest {
  nome?: string;
  titolo?: string;
  versione?: string;
  /** Il proprietario delle tabelle `plugin_<nick>_…`; senza, il plugin non scrive. */
  nick?: string;
  /** La versione della struttura delle sue tabelle che il codice si aspetta. */
  schemaVersion?: number;
  ui?: Record<string, unknown>;
  anchors?: Record<string, boolean>;
  /** Percorsi raggiungibili senza sessione (vedi plugin-public.ts). */
  pubblici?: unknown;
  /**
   * Il nome con cui si monta (`/plugins/<montaCome>/`), se diverso dalla
   * cartella: la versione pro di un plugin prende il posto della base senza
   * che gli assistenti già collegati se ne accorgano (06/09/2026).
   */
  montaCome?: unknown;
  /** Capacità chieste al core: `google:oauth` per le credenziali OAuth Google. */
  permessi?: unknown;
  /** Il percorso di salute, pubblico da sé. */
  health?: unknown;
  /** La scheda nella pagina Sistema (22/09/2026): di chi è, con che licenza, a cosa serve. */
  copyright?: unknown;
  licenza?: unknown;
  descrizione?: unknown;
  /** Una riga per lingua: `{ it, en, fr, de, es }`. */
  sommario?: unknown;
  /** L'edizione che serve (`commerciale`), le funzioni senza cui non parte, quelle che usa. */
  edizione?: unknown;
  richiede?: unknown;
  usa?: unknown;
}

/**
 * Il contributo di un plugin al riepilogo delle 7:00 (contratto in
 * plugins/LEGGIMI.md, «Il riepilogo del mattino»): per ogni persona che ha
 * qualcosa da sentirsi dire, una funzione che scrive le righe nella sua
 * lingua — il core sa la lingua del destinatario, il plugin no.
 */
export interface ContributoRiepilogo {
  userId: string;
  righe: (locale: string) => string[];
}
export type RiepilogoMattutino = (opzioni: { oggi: string }) => Promise<ContributoRiepilogo[]>;

/** Quello che `create(ctx)` restituisce. */
interface PluginDefinition {
  routes: unknown[];
  staticDir?: string;
  wellKnown?: string[];
  /** Porta le tabelle dalla versione `from` a `manifest.schemaVersion`. */
  migrate?: (db: unknown, from: number) => Promise<void>;
  /** Le righe del plugin nel riepilogo del mattino, per chi ne ha. */
  riepilogoMattutino?: RiepilogoMattutino;
  /** Gli strumenti che offre agli altri plugin (plugin-strumenti.ts). */
  strumenti?: unknown;
}

/** Il driver dell'SDK, per quel poco che il core gli chiede direttamente. */
interface SdkDriver {
  run: (sql: string, ...params: unknown[]) => Promise<{ changes: number }>;
  get: (sql: string, ...params: unknown[]) => Promise<Record<string, unknown> | undefined>;
}

interface SdkConfigStore {
  ensure: () => Promise<void>;
  get: (name: string) => Promise<string | null>;
  set: (name: string, value: string) => Promise<void>;
}

const NICK = /^[a-z][a-z0-9_]*$/;
const RUOLI_INTERNI: readonly string[] = [UserRole.ADMIN, UserRole.MEMBER];

/**
 * **La voce di menù, letta dal manifesto e validata.** Un valore che il core
 * non capisce non rompe il menù: ripiega sul default e lo dice nel log, con il
 * nome del plugin — chi lo sta scrivendo lo legge lì, non in un 500.
 */
/** Il nome di montaggio: `montaCome` del manifesto, o la cartella. */
function montaggio(manifest: Manifest, name: string): string {
  return manifest.montaCome !== undefined ? String(manifest.montaCome) : name;
}

function chiede(manifest: Manifest, permesso: string): boolean {
  return Array.isArray(manifest.permessi) && manifest.permessi.map(String).includes(permesso);
}

function chiedeGoogle(manifest: Manifest): boolean {
  return chiede(manifest, "google:oauth");
}

/** Un percorso relativo alla cartella del plugin, senza trucchi (`..`, assoluti, query). */
const PERCORSO_RELATIVO = /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/;

/**
 * **Il bottone nella barra in alto** (`ui.barra`, 23/09/2026): icona, stato e
 * pannello, tutti del plugin. Uno scritto male non rompe la barra: non compare,
 * e il log dice perché.
 */
function leggiBarra(
  name: string,
  ui: Record<string, unknown>,
  avvisa: (messaggio: string) => void,
  staticDir?: string,
): PluginUiEntry["barra"] {
  if (ui.barra === undefined || ui.barra === null) return null;
  const b = ui.barra as Record<string, unknown>;
  const stato = String(b.stato ?? "");
  const pannello = String(b.pannello ?? "");
  const icona = String(b.icona ?? "puzzle");
  for (const [campo, valore] of [["stato", stato], ["pannello", pannello]] as const) {
    if (!PERCORSO_RELATIVO.test(valore) || valore.includes("..")) {
      avvisa(`plugin "${name}": ui.barra.${campo} "${valore}" non è un percorso valido, niente bottone`);
      return null;
    }
  }
  let iconaUrl: string | null = null;
  if (/\.(svg|png)$/i.test(icona)) {
    if (PERCORSO_RELATIVO.test(icona) && !icona.includes("..") && staticDir && existsSync(path.join(staticDir, icona))) {
      iconaUrl = `/plugins/${name}/${icona}`;
    } else {
      avvisa(`plugin "${name}": ui.barra.icona "${icona}" non esiste nella cartella statica, uso il puzzle`);
    }
  }
  return {
    icona: iconaUrl ? icona : /\.(svg|png)$/i.test(icona) ? "puzzle" : icona,
    iconaUrl,
    statoUrl: `/plugins/${name}/${stato}`,
    pannelloUrl: `/plugins/${name}/${pannello}`,
  };
}

export function leggiVoceUi(
  name: string,
  manifest: Manifest,
  avvisa: (messaggio: string) => void,
  staticDir?: string,
): PluginUiEntry {
  const ui = (manifest.ui ?? {}) as Record<string, unknown>;

  // **L'icona: un nome del set, oppure un file del plugin.** `ui.icona:
  // "icona.svg"` vuol dire «la mia, nella cartella statica»: monocromatica,
  // perché il browser la tinge del colore del testo come le altre. Se il
  // file non c'è si ripiega sul puzzle, e lo si dice.
  let icona = String(ui.icona ?? "puzzle");
  let iconaUrl: string | null = null;
  if (/\.(svg|png)$/i.test(icona)) {
    const file = icona.replace(/^\/+/, "");
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(file) || file.includes("..")) {
      avvisa(`plugin "${name}": ui.icona "${icona}" non è un nome di file valido, uso il puzzle`);
      icona = "puzzle";
    } else if (staticDir && existsSync(path.join(staticDir, file))) {
      iconaUrl = `/plugins/${name}/${file}`;
    } else {
      avvisa(
        `plugin "${name}": ui.icona "${icona}" non esiste nella cartella statica, uso il puzzle`,
      );
      icona = "puzzle";
    }
  }

  let sezione: PluginUiSection = "aree";
  if (ui.sezione !== undefined) {
    if ((PLUGIN_UI_SECTIONS as readonly string[]).includes(String(ui.sezione))) {
      sezione = String(ui.sezione) as PluginUiSection;
    } else {
      avvisa(`plugin "${name}": ui.sezione "${String(ui.sezione)}" sconosciuta, va fra le aree`);
    }
  }

  let dopo: string | null = null;
  if (ui.dopo !== undefined && ui.dopo !== null) {
    const valore = String(ui.dopo);
    if ((NAV_AREA_KEYS as readonly string[]).includes(valore) || /^[A-Za-z0-9_-]+$/.test(valore)) {
      dopo = valore;
    } else {
      avvisa(
        `plugin "${name}": ui.dopo "${valore}" non è un'area né un nome di plugin, va in coda`,
      );
    }
  }

  let ruoli: string[] | null = null;
  if (Array.isArray(ui.ruoli)) {
    const validi = ui.ruoli.map(String).filter((r) => RUOLI_INTERNI.includes(r));
    const scartati = ui.ruoli.map(String).filter((r) => !RUOLI_INTERNI.includes(r));
    if (scartati.length > 0) {
      avvisa(
        `plugin "${name}": ui.ruoli ignora ${scartati.join(", ")} (solo ${RUOLI_INTERNI.join(", ")})`,
      );
    }
    ruoli = validi.length > 0 ? validi : null;
  } else if (ui.ruoli !== undefined && ui.ruoli !== null) {
    avvisa(`plugin "${name}": ui.ruoli dev'essere un elenco, lo ignoro`);
  }

  return {
    nome: name,
    titolo: String(manifest.titolo ?? name),
    voce: String(ui.voce ?? name),
    icona,
    iconaUrl,
    menu: ui.menu !== false && String(ui.menu ?? "") !== "false",
    anchors: manifest.anchors ?? {},
    sezione,
    dopo,
    ruoli,
    soloManager: ui.soloManager === true,
    // `soloGruppo`: la voce è per chi sta nel gruppo del plugin. Chi guarda lo
    // sa solo a richiesta fatta, quindi qui `nelGruppo` resta null e lo
    // riempie `/api/plugins/ui`, che conosce la sessione.
    soloGruppo: ui.soloGruppo === true,
    nelGruppo: null,
    nick: manifest.nick ?? null,
    versione: String(manifest.versione ?? "0.0.0"),
    schemaVersion: manifest.nick ? Number(manifest.schemaVersion ?? 0) : null,
    barra: leggiBarra(name, ui, avvisa, staticDir),
  };
}

/**
 * **Le tabelle del plugin, prima di montarlo.** Le tre domande del contratto:
 *
 * 1. `plugin_<nick>_config` esiste (la crea il core, se manca, vuota);
 * 2. la versione della struttura in tabella non è più avanti del codice —
 *    altrimenti è un plugin riportato indietro, e si rifiuta invece di farlo
 *    girare su tabelle che non capisce;
 * 3. se è indietro, `migrate(db, from)` la porta al numero atteso, e dopo la
 *    chiamata la tabella DEVE dire quel numero: una migrazione che si ferma a
 *    metà lascia la versione dell'ultimo passo riuscito (`applyMigrations`
 *    dell'SDK scrive dopo ogni passo), e il core la vede.
 *
 * Alla fine `plugin_version` prende la versione del manifesto. Tutto passa
 * dal driver del plugin, quindi ogni tabella scritta porta il prefisso:
 * il cancello è lì (`sql-targets.mjs`), non qui.
 */
async function preparaTabelle(
  name: string,
  manifest: Manifest,
  def: PluginDefinition,
  db: SdkDriver,
  sdkDb: Record<string, CallableFunction>,
): Promise<void> {
  const nick = manifest.nick!;
  const attesa = Number(manifest.schemaVersion ?? 0);
  if (!Number.isInteger(attesa) || attesa < 0) {
    throw new Error(
      `schemaVersion dev'essere un intero ≥ 0, non "${String(manifest.schemaVersion)}"`,
    );
  }
  const cfg = sdkDb.pluginConfig!(db, nick) as SdkConfigStore;
  await cfg.ensure();
  const inTabella = Number((await cfg.get("schema_version")) ?? 0);
  if (inTabella > attesa) {
    throw new Error(
      `le tabelle di "${nick}" sono alla versione ${inTabella}, il codice si aspetta la ${attesa}: ` +
        "plugin riportato indietro, non lo monto",
    );
  }
  if (inTabella < attesa) {
    if (!def.migrate) {
      throw new Error(
        `le tabelle di "${nick}" sono alla versione ${inTabella}, attesa la ${attesa}, ma create() non restituisce migrate()`,
      );
    }
    await def.migrate(db, inTabella);
    const dopo = Number((await cfg.get("schema_version")) ?? 0);
    if (dopo !== attesa) {
      throw new Error(
        `migrazione di "${nick}" incompleta: la tabella dice ${dopo}, il codice si aspetta ${attesa}`,
      );
    }
  }
  await cfg.set("plugin_version", String(manifest.versione ?? "0.0.0"));
}

/**
 * I plugin montati, per chi li vuole elencare (la pagina Sistema): nome,
 * versione del codice, versione della struttura. Vuoto finché il porta-plugin
 * non ha finito, o se `PLUGINS` è vuoto.
 */
let montati: PluginUiEntry[] = [];
export function pluginMontati(): PluginUiEntry[] {
  return montati;
}

/**
 * **Le schede dei plugin per la pagina Sistema** (22/09/2026): quelli caricati
 * e quelli che stanno nella cartella ma non sono installati. Lo stato acceso o
 * spento si legge al momento, perché cambia senza riavvio.
 */
let schede: Array<Omit<PluginScheda, "attivo">> = [];
/** Perché un plugin di `PLUGINS` non si è montato in questa edizione (per la scheda). */
const rifiutatiPerEdizione = new Map<string, string>();
export function schedePlugin(): PluginScheda[] {
  return schede.map((s) => ({ ...s, attivo: s.installato && !pluginDisattivato(s.nome) }));
}

/** Una riga su a cosa serve, per lingua; l'italiano ripiega sulla descrizione. */
export function leggiSommario(manifest: Manifest): Record<string, string> {
  const out: Record<string, string> = {};
  if (manifest.sommario && typeof manifest.sommario === "object") {
    for (const [lingua, testo] of Object.entries(manifest.sommario as Record<string, unknown>)) {
      if (typeof testo === "string" && testo.trim()) out[lingua] = testo.trim();
    }
  }
  if (!out.it && typeof manifest.descrizione === "string") {
    // la prima frase della descrizione: la scheda è una riga, non un documento
    const prima = manifest.descrizione.split(/(?<=[.!?])\s/)[0] ?? manifest.descrizione;
    out.it = prima.length > 220 ? `${prima.slice(0, 217)}…` : prima;
  }
  return out;
}

function schedaDi(
  nome: string,
  manifest: Manifest,
  installato: boolean,
): Omit<PluginScheda, "attivo"> {
  const testo = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    nome,
    titolo: String(manifest.titolo ?? nome),
    versione: String(manifest.versione ?? "0.0.0"),
    schemaVersion: manifest.nick ? Number(manifest.schemaVersion ?? 0) : null,
    nick: manifest.nick ?? null,
    copyright: testo(manifest.copyright),
    licenza: testo(manifest.licenza),
    sommario: leggiSommario(manifest),
    installato,
    motivo: installato ? null : (rifiutatiPerEdizione.get(nome) ?? null),
  };
}

/**
 * I plugin che stanno nella cartella ma il core non ha caricato: non sono in
 * `PLUGINS`, oppure ci sono e l'avvio li ha rifiutati (il motivo è nel log).
 * Si legge solo `manifest.json`: importare il codice di un plugin non
 * installato per sapere come si chiama sarebbe già eseguirlo.
 */
function nonInstallati(pluginsDir: string, occupati: Set<string>): Array<Omit<PluginScheda, "attivo">> {
  const out: Array<Omit<PluginScheda, "attivo">> = [];
  let cartelle: string[] = [];
  try {
    cartelle = readdirSync(pluginsDir);
  } catch {
    return out;
  }
  for (const cartella of cartelle) {
    if (cartella === "keelops-sdk" || cartella.startsWith(".")) continue;
    const file = path.join(pluginsDir, cartella, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
      const nome = String(manifest.nome ?? cartella);
      // un plugin sostituito da un altro che monta al suo posto (mcp da MCP-pro) non si elenca
      if (occupati.has(nome) || occupati.has(cartella)) continue;
      out.push(schedaDi(nome, manifest, false));
    } catch {
      /* un manifesto illeggibile non è un plugin da elencare */
    }
  }
  return out.sort((a, b) => a.titolo.localeCompare(b.titolo));
}

/**
 * **Il primo aggancio del core verso i plugin** (06/09/2026): il riepilogo
 * delle 7:00 chiede a ognuno se ha righe da aggiungere. Un plugin che
 * risponde male o lento non ferma il riepilogo: la sua parte manca, e il log
 * lo dice. I test registrano qui un contributore finto.
 */
const contributori = new Map<string, RiepilogoMattutino>();
export function registraRiepilogoMattutino(nome: string, fn: RiepilogoMattutino): () => void {
  contributori.set(nome, fn);
  return () => {
    contributori.delete(nome);
  };
}
export async function contributiAlRiepilogo(
  oggi: string,
  avvisa: (messaggio: string) => void = (m) => console.warn(m),
  tempoMassimoMs = 10_000,
): Promise<Map<string, Array<(locale: string) => string[]>>> {
  const perUtente = new Map<string, Array<(locale: string) => string[]>>();
  for (const [nome, fn] of contributori) {
    // spento vuol dire anche fuori dal riepilogo del mattino
    if (pluginDisattivato(nome)) continue;
    try {
      const risposta = await Promise.race([
        fn({ oggi }),
        new Promise<never>((_, no) =>
          setTimeout(
            () => no(new Error(`nessuna risposta in ${tempoMassimoMs} ms`)),
            tempoMassimoMs,
          ),
        ),
      ]);
      for (const c of Array.isArray(risposta) ? risposta : []) {
        if (typeof c?.userId !== "string" || typeof c.righe !== "function") continue;
        perUtente.set(c.userId, [...(perUtente.get(c.userId) ?? []), c.righe]);
      }
    } catch (err) {
      avvisa(`plugin "${nome}": il contributo al riepilogo è saltato: ${(err as Error).message}`);
    }
  }
  return perUtente;
}

export async function registerPluginHost(
  app: FastifyInstance,
  options?: { pluginsDir?: string; publicBase?: string },
): Promise<void> {
  const names = parsePluginNames(config.pluginsSpec);
  const pluginsDir = options?.pluginsDir ?? config.pluginsDir;
  await caricaStatoPlugin();
  if (!names.length) {
    // nessuno installato: la pagina Sistema elenca comunque quelli presenti
    schede = nonInstallati(pluginsDir, new Set());
    return;
  }
  const publicBase = options?.publicBase ?? (config.publicUrl || `http://127.0.0.1:${config.port}`);

  // l'SDK è parte del codice, non un plugin: sempre dal repo
  const sdkDir = path.join(config.rootDir, "plugins", "keelops-sdk");
  const sdk = await importOutside(pathToFileURL(path.join(sdkDir, "http.mjs")).href);
  const sdkDb = await importOutside(pathToFileURL(path.join(sdkDir, "database.mjs")).href);
  /**
   * Gli script che l'SDK dà al browser. Il guscio li serve come file perché la
   * CSP di produzione non esegue niente di inline (vedi la rotta `sdk/:file`).
   */
  const sdkUi = (await importOutside(pathToFileURL(path.join(sdkDir, "ui.mjs")).href)) as unknown as {
    TEMA_SCRIPT: string;
    FRAME_RESIZE_SCRIPT: string;
    TRADUZIONI_SCRIPT: string;
  };
  const scriptSdk: Record<string, string> = {
    "tema.js": sdkUi.TEMA_SCRIPT,
    "riquadro.js": sdkUi.FRAME_RESIZE_SCRIPT,
    // l'unico meccanismo di traduzione delle pagine dei plugin (22/09/2026)
    "traduzioni.js": sdkUi.TRADUZIONI_SCRIPT,
  };

  /**
   * Il database arriva ai plugin già come DRIVER dell'astrazione dell'SDK
   * (`keelops-sdk/database.mjs`), e quale driver dipende da cosa il plugin è.
   *
   * Un plugin **senza tabelle proprie** legge e basta: su SQLite apre il file
   * per conto suo in sola lettura — la garanzia più forte che esista — e
   * altrove riceve in prestito la connessione del core, con il cancello che
   * lascia passare solo le letture.
   *
   * Un plugin **con un nick** possiede le sue tabelle e deve poterci scrivere:
   * riceve la connessione del core su ogni motore, e il cancello lascia
   * passare le scritture che portano il suo prefisso, nessun'altra. È il
   * client raw: un plugin non conosce la cancellazione morbida del core, e non
   * deve — le sue righe sono sue.
   */
  const driverPerIlPlugin = async (nick: string | null): Promise<unknown> => {
    if (!nick && motore === "sqlite") return sdkDb.openDatabase!(databasePath);
    /**
     * **Le letture passano da una connessione che non sa scrivere** (V3 di
     * PLAN_OPTIMIZE, 05/09/2026): su SQLite un secondo accesso al file in
     * sola lettura, su MariaDB una sessione dichiarata READ ONLY al motore.
     * Il cancello sul testo (`sql-targets.mjs`) resta, ed è lui a dare
     * l'errore leggibile — ma non è più l'unica barriera. Le scritture di un
     * plugin con nick vanno sulla connessione del core, col prefisso obbligato.
     */
    const query =
      motore === "sqlite"
        ? sdkDb.readOnlyQuery!(databasePath)
        : await (async () => {
            const ro = await connessioneSolaLettura();
            return (sql: string, params: unknown[]) => ro.$queryRawUnsafe(sql, ...params);
          })();
    return sdkDb.borrowedDriver!({
      dialect: motore,
      nick,
      query,
      execute: nick
        ? (sql: string, params: unknown[]) => prismaRaw.$executeRawUnsafe(sql, ...params)
        : undefined,
    });
  };

  const mounted: PluginUiEntry[] = [];
  const schedeMontate: Array<Omit<PluginScheda, "attivo">> = [];
  /** I nomi già presi: un plugin sostituito da uno che monta al suo posto non si elenca due volte. */
  const occupati = new Set<string>();
  const puntiDiMontaggio = new Set<string>();

  // Le funzioni dell'edizione, uguali per tutti i plugin di questo avvio.
  const funzioni = funzioniDellEdizione();
  rifiutatiPerEdizione.clear();
  for (const name of names) {
    const entry = path.join(pluginsDir, name, "plugin.mjs");
    if (!existsSync(entry)) {
      app.log.warn(`plugin "${name}": ${entry} non esiste, salto`);
      continue;
    }
    let dispatch: Dispatch;
    let staticDir: string | undefined;
    let wellKnown: string[] = [];
    let manifest: Manifest = {};
    /**
     * Lo stato del plugin vive sotto la DATA DIR dell'installazione, come
     * uploads e backup: è l'unico posto che il deploy non tocca e che la
     * unit systemd (ProtectSystem=strict) lascia scrivere — dentro app/ il
     * filesystem è in sola lettura, e il primo mkdir moriva lì (23/08/2026).
     */
    const dataDir = path.join(path.dirname(databasePath), "plugins", name);
    try {
      mkdirSync(dataDir, { recursive: true });
      const mod = await importOutside(pathToFileURL(entry).href);
      manifest = ((mod as { manifest?: Manifest }).manifest ?? {}) as Manifest;
      if (
        manifest.montaCome !== undefined &&
        !/^[A-Za-z0-9_-]+$/.test(String(manifest.montaCome))
      ) {
        throw new Error(`montaCome "${String(manifest.montaCome)}" non è un nome valido`);
      }
      if (manifest.nick !== undefined && !NICK.test(String(manifest.nick))) {
        throw new Error(
          `nick "${String(manifest.nick)}" non valido: minuscole, cifre e trattino basso, e comincia con una lettera`,
        );
      }
      // Un plugin che chiede un'edizione o delle funzioni che qui non ci sono non
      // si monta: lo dicono il log e la sua scheda in Sistema.
      const rifiuto = rifiutoPerEdizione(manifest, edizioneInVigore(), funzioni);
      if (rifiuto) {
        rifiutatiPerEdizione.set(String(manifest.nome ?? name), rifiuto);
        throw new Error(rifiuto);
      }
      const nick = manifest.nick ?? null;
      const mountPrevisto = montaggio(manifest, name);
      const db = await driverPerIlPlugin(nick);
      // `create` può essere asincrona: il pro carica la base da ctx.pluginsDir
      const def = (await mod.create!({
        dbPath: databasePath,
        db,
        dataDir,
        keelopsUrl: config.publicUrl,
        // Il modello locale solo dove l'edizione lo usa (vedi plugin-edition.ts).
        ollamaUrl: funzioni.has("ollama") ? config.ollamaUrl || null : null,
        // In che edizione si gira e cosa c'è: un plugin si adatta da qui.
        edizione: edizioneInVigore(),
        funzioni,
        // Dove stanno gli altri plugin e l'SDK: un plugin collegato da fuori
        // (symlink) vede la propria cartella reale, e `../mcp` non esiste lì.
        pluginsDir,
        sdkDir,
        publicUrl: `${publicBase}/plugins/${montaggio(manifest, name)}`,
        sessionUser: pluginSessionUser,
        // Gli allegati con la regola di accesso del core (plugin-attachments.ts):
        // `read` da settembre, `write` dal 21/09/2026 per i documenti che un
        // plugin genera e allega al task a nome di chi lo sta usando.
        //
        // **Il nick lo mette il core, non il plugin**: ogni porta che scrive
        // nel core è legata qui al plugin che la riceve, così la riga nasce
        // marcata e nessun plugin può firmarsi col nome di un altro
        // (22/09/2026).
        attachments: {
          read: leggiAllegatoPerPlugin,
          write: (
            userId: string,
            taskId: string,
            opzioni: Parameters<typeof scriviAllegatoPerPlugin>[3],
          ) => scriviAllegatoPerPlugin(nick, userId, taskId, opzioni),
        },
        // Il predicato di modifica del core: il plugin non se lo riscrive.
        perimeter: { canEditTask: puoModificareTaskPerPlugin },
        // I task, con le regole del core (plugin-tasks.ts): dal 22/09/2026, per
        // i plugin che generano lavoro — un'azione correttiva, una verifica.
        tasks: {
          create: (userId: string, input: Parameters<typeof creaTaskPerPlugin>[2]) =>
            creaTaskPerPlugin(nick, userId, input),
          read: leggiTaskPerPlugin,
          readMany: leggiTaskPerPluginMolti,
        },
        /**
         * I gruppi (plugin-groups.ts): un plugin che governa un mestiere deve
         * poter dire **chi lo fa**. Crea il suo gruppo una volta, marcato col
         * suo nick; poi è un gruppo come gli altri, e l'amministratore comanda.
         */
        groups: {
          ensure: (input: Parameters<typeof assicuraGruppoPerPlugin>[1]) =>
            assicuraGruppoPerPlugin(nick, input),
          read: (chiave: string) => leggiGruppoDelPlugin(nick, chiave),
          members: (chiave: string) => membriGruppoDelPlugin(nick, chiave),
        },
        // Le credenziali OAuth Google, solo a chi le chiede nel manifesto: il
        // plugin non legge l'`.env` del core, e il segreto non passa per il
        // browser. Servono al collegamento Drive per utente (MCP-pro).
        /**
         * **Gli strumenti degli altri plugin** (plugin-strumenti.ts), solo a
         * chi li chiede con `plugins:strumenti`: è il tunnel con cui il
         * connettore MCP pro offre agli assistenti le schede di QABox.
         */
        plugins: chiede(manifest, "plugins:strumenti")
          ? { strumenti: () => strumentiPer(mountPrevisto) }
          : null,
        /**
         * **Un segnale alla persona** sul canale in tempo reale del core: il
         * suo bottone nella barra si rinfresca subito, senza aspettare il giro
         * del minuto. Il nome del plugin lo mette il core. Niente coda: chi
         * non è collegato non lo riceve, ed è giusto — è un avviso, non un
         * messaggio.
         */
        segnali: {
          invia: (userId: string, dati: Record<string, unknown> = {}) =>
            pushSse(userId, { ...dati, kind: "plugin", plugin: mountPrevisto }),
        },
        /**
         * **Le ore nel timesheet** (commercial/plugin-timesheet.ts), solo a chi le chiede
         * con `timesheet:write`: si sommano a quelle scritte a mano, con le
         * regole della griglia. Dal 29/09/2026, per i rapportini.
         */
        // La presta il modulo timesheet: nella community vale `null` anche a chi la chiede.
        timesheet: chiede(manifest, "timesheet:write") ? portaPlugin("timesheet") : null,
        /**
         * **La posta del core** (plugin-mail.ts), solo con `mail:send`: il
         * messaggio esce col canale e il marchio di KeelOps, e la risposta
         * torna a chi l'ha mandato.
         */
        mail: chiede(manifest, "mail:send")
          ? { invia: inviaEmailPerPlugin, attiva: postaAttivaPerPlugin }
          : null,
        // Only with the commercial `google` module: in the community `null`.
        google: chiedeGoogle(manifest) && haModulo("google")
          ? {
              enabled: config.oauth.google.enabled,
              clientId: config.oauth.google.clientId,
              clientSecret: config.oauth.google.clientSecret,
            }
          : null,
      })) as PluginDefinition;
      if (nick) await preparaTabelle(name, manifest, def, db as SdkDriver, sdkDb);
      if (typeof def.riepilogoMattutino === "function")
        registraRiepilogoMattutino(name, def.riepilogoMattutino);
      registraStrumenti(
        mountPrevisto,
        {
          // il prefisso è il nick (è già il nome «tecnico» del plugin), o il nome di montaggio
          prefisso: nick ?? mountPrevisto.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          titolo: String(manifest.titolo ?? mountPrevisto),
          versione: String(manifest.versione ?? "0.0.0"),
        },
        def.strumenti,
        (messaggio) => app.log.warn(messaggio),
      );
      dispatch = sdk.createDispatcher!({
        routes: def.routes,
        staticDir: def.staticDir,
        name,
      });
      staticDir = def.staticDir;
      wellKnown = def.wellKnown ?? [];
    } catch (err) {
      app.log.error(`plugin "${name}" non caricato: ${(err as Error).message}`);
      // eslint-disable-next-line no-console
      console.error(`[plugin-host] "${name}":`, err);
      continue;
    }

    const mount = montaggio(manifest, name);
    if (puntiDiMontaggio.has(mount)) {
      app.log.error(`plugin "${name}": /plugins/${mount}/ è già montato da un altro plugin, salto`);
      continue;
    }
    puntiDiMontaggio.add(mount);
    const pubblici = leggiPubblici(name, manifest, (messaggio) => app.log.warn(messaggio));
    await app.register(
      async (scope) => {
        // i corpi restano flussi grezzi: i gestori dei plugin li leggono da sé
        scope.addContentTypeParser("*", (request, payload, done) => done(null, payload));
        scope.removeContentTypeParser(["application/json", "text/plain"]);
        scope.addContentTypeParser(["application/json", "text/plain"], (request, payload, done) =>
          done(null, payload),
        );
        // La guardia di sessione del core vale anche qui (auth.ts): ogni
        // rotta porta il nome del plugin e i suoi percorsi pubblici.
        const config = { plugin: { name: mount, pubblici } };
        /**
         * **Gli script del browser dell'SDK, serviti come file.**
         *
         * In produzione la CSP è `script-src 'self'`: **uno script inline in
         * una pagina di plugin non viene eseguito**, e non lo si scopre in
         * sviluppo perché lì la CSP è spenta. Il tema che non segue quello del
         * guscio e il riquadro che non si ridimensiona sono lo stesso difetto,
         * e sono comparsi in tre plugin su cinque — perché ognuno doveva
         * ricordarsi di servirseli da sé, e due su cinque se lo sono
         * ricordato (09/09/2026).
         *
         * Li serve il guscio, per **tutti** i plugin, allo stesso indirizzo:
         * `sdk/tema.js` e `sdk/riquadro.js` relativi alla pagina del plugin.
         * Chi se li serviva già continua a funzionare: questa non toglie
         * niente, aggiunge una strada che c'è sempre.
         */
        scope.get("/sdk/:file", { config }, async (request, reply) => {
          const { file } = request.params as { file: string };
          const corpo = scriptSdk[file];
          if (corpo === undefined) return reply.status(404).send({ error: "NOT_FOUND" });
          return reply
            .header("content-type", "text/javascript; charset=utf-8")
            // Cambiano con l'SDK, cioè con un rilascio: un'ora è un compromesso
            // fra il non richiederli a ogni apertura e il non tenerseli vecchi.
            .header("cache-control", "public, max-age=3600")
            .send(corpo);
        });

        /**
         * **Un plugin spento non risponde** (22/09/2026): pagine, API, script
         * dell'SDK, tutto quello che sta sotto /plugins/<nome>/. Chi apre la
         * pagina legge una riga nella sua lingua; chi chiama le API riceve un
         * codice da riconoscere. Il plugin resta caricato, e riacceso torna
         * com'era senza riavvio.
         */
        scope.addHook("onRequest", async (request, reply) => {
          if (!pluginDisattivato(mount)) return;
          const locale = localeFromRequest(request);
          const messaggio = serverT(locale, "Questo plugin è disattivato: lo riaccende un amministratore da Sistema.");
          const vuoleHtml = String(request.headers.accept ?? "").includes("text/html");
          if (vuoleHtml) {
            return reply
              .status(404)
              .type("text/html; charset=utf-8")
              .send(`<!doctype html><meta charset="utf-8"><title>${mount}</title><p style="font:14px system-ui;margin:2rem">${messaggio}</p>`);
          }
          return reply.status(404).send({ error: "PLUGIN_DISABLED", message: messaggio });
        });

        // la wildcard copre anche la radice con la barra (/plugins/<nome>/)
        scope.all("/*", { config }, (request, reply) => {
          reply.hijack();
          const stripped = request.raw.url!.slice(`/plugins/${mount}`.length) || "/";
          void dispatch(request.raw, reply.raw, stripped);
        });
        /**
         * Il percorso SENZA barra è quello che i client incollano
         * (`…/plugins/mcp`): un browser va reindirizzato alla barra (i
         * percorsi relativi risolvono da lì), ma il POST di un connettore MCP
         * va servito QUI e direttamente — molti client non seguono i redirect
         * sul POST, e Claude rispondeva 404 (23/08/2026). Dentro lo scope, coi
         * parser-passacarte, il corpo arriva intatto al plugin.
         */
        scope.route({
          method: ["GET", "POST", "DELETE", "HEAD"],
          url: "/",
          prefixTrailingSlash: "no-slash",
          config,
          handler: (request, reply) => {
            const wantsHtml =
              request.method === "GET" &&
              String(request.headers.accept ?? "").includes("text/html");
            if (wantsHtml) return reply.redirect(`/plugins/${mount}/`, 308);
            reply.hijack();
            void dispatch(request.raw, reply.raw, "/");
          },
        });
      },
      { prefix: `/plugins/${mount}` },
    );

    // la forma "per inserzione" dei metadati OAuth (RFC 8414): i client MCP la
    // usano quando l'issuer ha un percorso, e va servita dalla radice
    for (const doc of wellKnown) {
      app.get(`/.well-known/${doc}/plugins/${mount}`, (request, reply) => {
        if (pluginDisattivato(mount)) return reply.status(404).send({ error: "PLUGIN_DISABLED" });
        reply.hijack();
        void dispatch(request.raw, reply.raw, `/.well-known/${doc}`);
      });
    }
    mounted.push(leggiVoceUi(mount, manifest, (messaggio) => app.log.warn(messaggio), staticDir));
    schedeMontate.push(schedaDi(mount, manifest, true));
    occupati.add(mount).add(name);
    app.log.info(
      `plugin "${name}" caricato su /plugins/${mount}/` +
        (manifest.nick
          ? ` (tabelle plugin_${manifest.nick}_*, struttura v${manifest.schemaVersion ?? 0})`
          : ""),
    );
  }

  // Le voci UI dei plugin montati: le legge il menu di AppShell e le ancore
  // contestuali (es. il bottone "Mappa" nella pagina progetto). Autenticata
  // come ogni /api: i plugin sono per chi è dentro.
  app.get("/api/plugins/ui", async (request) => {
    /**
     * **Chi vede cosa**, deciso qui e non nel browser: per un plugin che
     * dichiara `soloGruppo` si guarda se chi chiede sta nel suo gruppo. La
     * voce sparisce dal menù, le **ancore no** — un'azione correttiva
     * assegnata a chi in qualità non ci lavora deve comunque dire da dove
     * viene (22/09/2026).
     */
    const user = request.currentUser;
    /**
     * L'amministratore vede la voce anche **senza essersi elevato**: è chi
     * mette le persone nel gruppo, e una voce che gli sparisce mentre la
     * configura è un vicolo cieco. Vedere non è potere: dentro, i permessi
     * del plugin restano quelli che sono.
     */
    const amministratore =
      user?.role === UserRole.ADMIN || request.authUser?.role === UserRole.ADMIN;
    const plugins = await Promise.all(
      // un plugin spento sparisce dal menù e dalle ancore, per tutti
      mounted.filter((voce) => !pluginDisattivato(voce.nome)).map(async (voce) => {
        if (!voce.soloGruppo || !voce.nick || !user) return voce;
        const dentro = amministratore || (await utenteNelGruppoDelPlugin(voce.nick, user.id));
        return { ...voce, nelGruppo: dentro };
      }),
    );
    return { plugins };
  });
  montati = mounted;
  schede = [...schedeMontate, ...nonInstallati(pluginsDir, occupati)];
}

/** Solo per i test: l'hash con cui il core scrive i token di sessione. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
