import { z } from "zod";

/**
 * **Dove una voce di menù può stare.** Le chiavi delle aree del menù laterale:
 * sono le stesse di `AREAS` nel browser (`components/layout/areas.tsx`, che un
 * test tiene allineato a questo elenco) e il server le usa per validare il
 * manifesto di un plugin che chiede di stare «dopo Bacheche». Un posto solo
 * per l'elenco: il giorno che nasce un'area, il manifesto la conosce.
 */
export const NAV_AREA_KEYS = [
  "home",
  "tasks",
  "deals",
  "projects",
  "tickets",
  "timesheet",
  "contacts",
  "help",
] as const;
export type NavAreaKey = (typeof NAV_AREA_KEYS)[number];

/** Le due sezioni del menù in cui un plugin può inserirsi. */
export const PLUGIN_UI_SECTIONS = ["aree", "amministrazione"] as const;
export type PluginUiSection = (typeof PLUGIN_UI_SECTIONS)[number];

/**
 * La voce che un plugin montato espone al browser (`GET /api/plugins/ui`).
 *
 * `sezione`, `dopo`, `ruoli` e `soloManager` sono del 05/09/2026: prima un
 * plugin finiva in coda alle aree e lo vedevano tutti, e «Personale» — che sta
 * fra le aree, dopo Bacheche, per i soli interni — non aveva modo di dirlo.
 * Il server valida i valori e ripiega sul default con un avviso nel log; il
 * browser li applica con lo stesso filtro delle voci native.
 */
export const pluginUiEntrySchema = z.object({
  nome: z.string(),
  titolo: z.string(),
  voce: z.string(),
  icona: z.string(),
  /**
   * L'icona propria del plugin, se il manifesto indica un file (`ui.icona:
   * "icona.svg"`) che esiste nella sua cartella statica: l'indirizzo da cui il
   * browser la prende. Null = si usa `icona` come nome del set lucide.
   */
  iconaUrl: z.string().nullable(),
  /** Compare nel menù principale? Un plugin contestuale (la mappa) dice di no. */
  menu: z.boolean(),
  /** Ancore contestuali: `{ project: true }` = bottone nella pagina progetto. */
  anchors: z.record(z.boolean()),
  sezione: z.enum(PLUGIN_UI_SECTIONS),
  /** Dopo quale voce stare: una chiave di `NAV_AREA_KEYS` o il nome di un altro plugin; null = in coda. */
  dopo: z.string().nullable(),
  /** Chi la vede: ruoli interni; null = tutti gli interni. */
  ruoli: z.array(z.string()).nullable(),
  /** Solo per chi guida un gruppo o un progetto. */
  soloManager: z.boolean(),
  /**
   * **Solo per chi sta nel gruppo del plugin** (`ui.soloGruppo` nel
   * manifesto, dal 22/09/2026). Un plugin che governa un mestiere — la
   * qualità — ha un suo gruppo, creato da `ctx.groups.ensure`: chi non ne fa
   * parte non vede la voce nel menù. Le **ancore restano a tutti**: chi si
   * trova assegnata un'azione correttiva deve poter leggere da dove viene,
   * anche se in reparto qualità non ci mette piede.
   */
  soloGruppo: z.boolean(),
  /**
   * Se chi ha chiesto l'elenco è dentro quel gruppo. Lo calcola il server per
   * ogni richiesta (null = la domanda non si pone, il plugin non ha gruppo).
   */
  nelGruppo: z.boolean().nullable(),
  /** Il proprietario delle tabelle `plugin_<nick>_…`; null = il plugin non ne ha. */
  nick: z.string().nullable(),
  /** Versione del codice del plugin, dal manifesto. */
  versione: z.string(),
  /** Versione della struttura delle sue tabelle; null = il plugin non ne ha. */
  schemaVersion: z.number().int().nullable(),
  /**
   * **Il bottone nella barra in alto** (`ui.barra` nel manifesto, dal
   * 23/09/2026), fra la campanella e il profilo: un'icona con un pallino di
   * stato, e al clic un piccolo pannello che è una pagina del plugin. Null =
   * il plugin non ne ha. Gli indirizzi sono già completi (`/plugins/<nome>/…`).
   */
  barra: z
    .object({
      icona: z.string(),
      iconaUrl: z.string().nullable(),
      /** GET → `PluginBarraStato`. */
      statoUrl: z.string(),
      /** La pagina del pannello, aperta in un riquadro sotto il bottone. */
      pannelloUrl: z.string(),
    })
    .nullable(),
});
export type PluginUiEntry = z.infer<typeof pluginUiEntrySchema>;

/**
 * **La scheda di un plugin nella pagina Sistema** (22/09/2026), per il super
 * admin: cosa c'è, di chi è, a cosa serve, e se è acceso.
 *
 * `installato` dice se il core lo ha caricato all'avvio (è in `PLUGINS` nel
 * `.env`): solo un plugin installato si accende e si spegne da qui, e subito.
 * Uno che sta nella cartella dei plugin ma non è installato compare lo stesso,
 * perché sapere che c'è è già un'informazione — ma si installa con il suo
 * `installa.sh` e un riavvio, non con un interruttore.
 */
export const pluginSchedaSchema = z.object({
  nome: z.string(),
  titolo: z.string(),
  versione: z.string(),
  /** Versione della struttura delle sue tabelle; null = non ne ha. */
  schemaVersion: z.number().int().nullable(),
  nick: z.string().nullable(),
  /** Di chi è: «© 2026 Jugaad s.r.l.». Null se il manifesto non lo dice. */
  copyright: z.string().nullable(),
  /** «libero», «commerciale»… come lo scrive il manifesto. */
  licenza: z.string().nullable(),
  /**
   * Una riga su a cosa serve, **per lingua** (`it`, `en`, `fr`, `de`, `es`):
   * la pagina mostra quella della persona, poi l'inglese, poi l'italiano.
   */
  sommario: z.record(z.string()),
  installato: z.boolean(),
  /**
   * Perché non è montato, se è perché questa edizione non lo prevede
   * (`edizione: "commerciale"`, o una funzione di `richiede` che manca).
   */
  motivo: z.string().nullable(),
  attivo: z.boolean(),
});
export type PluginScheda = z.infer<typeof pluginSchedaSchema>;

export const setPluginAttivoSchema = z.object({ attivo: z.boolean() });
export type SetPluginAttivoInput = z.infer<typeof setPluginAttivoSchema>;

/**
 * **Lo stato del bottone di un plugin nella barra**, come lo restituisce il
 * suo `ui.barra.stato`. Il core lo disegna e basta: il significato dei toni lo
 * decide il plugin, e il testo lo scrive lui nella lingua di chi guarda.
 *
 * - `tono`: il colore del pallino — `acceso` (verde), `spento` (grigio),
 *   `bloccato` (ambra: acceso e non si spegne), `nessuno` (niente pallino);
 * - `lampeggia`: c'è stata attività da poco, e il pallino batte;
 * - `titolo`: il suggerimento al passaggio del mouse, e l'etichetta per chi
 *   non vede.
 */
export const pluginBarraStatoSchema = z.object({
  tono: z.enum(["acceso", "spento", "bloccato", "nessuno"]),
  lampeggia: z.boolean(),
  titolo: z.string(),
});
export type PluginBarraStato = z.infer<typeof pluginBarraStatoSchema>;
