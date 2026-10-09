# The manifest

The manifest is the plugin's identity card. The core reads it when it loads
the plugin (the `manifest` export of `plugin.mjs`), and the System page reads
it — from `manifest.json` — even for plugins that are present in the folder
but not installed. Keep it in `manifest.json` and export it from `plugin.mjs`
with `JSON.parse(readFileSync(...))`, as every bundled plugin does: one
source, two readers.

A value the core does not understand never stops the plugin from loading: it
falls back to the default and says so in the log, with the plugin's name.

## A complete example

```json
{
  "nome": "QABox",
  "titolo": "Quality",
  "versione": "0.3.0",
  "nick": "qabox",
  "schemaVersion": 2,
  "descrizione": "Quality processes for manufacturers: specifications, inspection plans, measurements, signed verdicts.",
  "sommario": {
    "it": "Qualità per chi produce: specifiche, controlli e misure, verdetto firmato.",
    "en": "Quality for manufacturers: specifications, inspections and measurements, signed verdict.",
    "fr": "…", "de": "…", "es": "…"
  },
  "copyright": "© 2026 Jugaad s.r.l.",
  "licenza": "commerciale",
  "permessi": ["tasks:read", "groups:write"],
  "ui": {
    "voce": "Qualità",
    "icona": "icona.svg",
    "menu": true,
    "sezione": "aree",
    "dopo": "projects",
    "ruoli": ["ADMIN", "MEMBER"],
    "soloGruppo": true
  },
  "anchors": { "task": true },
  "pubblici": [],
  "health": "/health"
}
```

## Identity

| field | type | meaning |
|---|---|---|
| `nome` | string | **Name.** The plugin is mounted at `/plugins/<nome>/` and opened at `/estensioni/<nome>`. Letters, digits, `-` and `_`. |
| `titolo` | string | **Title**, as people read it (the System page, the frame title). Defaults to `nome`. |
| `versione` | string | **Version** of the code, semantic (`0.3.0`). Written in the plugin's config table at every start. |
| `montaCome` | string | **Mount as**: mount under another name. A pro edition takes the place of the free one without breaking clients already connected to its address (MCP-pro mounts as `mcp`). Two plugins cannot share a mount point: the second is refused. |
| `descrizione` | string | A paragraph on what the plugin does, in Italian: the fallback for `sommario`. |
| `sommario` | object | **Summary**: one sentence per language — `{ it, en, fr, de, es }`. The System page shows it in the reader's language, then English, then Italian. Without it, the first sentence of `descrizione`. |
| `copyright` | string | One line, as it should be printed: `"© 2026 Your Company"`. |
| `licenza` | string | **Licence**: `libero` (free) or `commerciale` (commercial); any other value is shown as written. |

## Editions

KeelOps comes in two editions: **community** and **commercial**. The
commercial one adds modules — tickets and the customer portal, timesheet,
the local models index, release notes… — and a plugin may depend on them.

| field | type | meaning |
|---|---|---|
| `edizione` | string | **Edition**: `"commerciale"` mounts the plugin only on a commercial core; `"community"` (or nothing) mounts it everywhere. Any other value is refused. |
| `richiede` | array | **Requires**: functions the plugin cannot work without (`["timesheet"]`). If one is missing, the plugin is not mounted. |
| `usa` | array | **Uses**: functions the plugin uses when they are there, and does without when they are not (`["timesheet", "ollama"]`). Information for readers: nothing is checked. |

A plugin that is not mounted for its edition says why — in the log, and on
its card in the System page. The function names are those of `ctx.funzioni`
(see [the context](03-context.md#edition-and-functions)): `ticket`,
`timesheet`, `indice-modelli`, `note-di-rilascio`, `analisi-offerte`,
`integrazioni`, `modulo-iniettabile`, `area-investitori`, and `ollama` (in
either edition, when configured). `licenza` stays a label: it does not decide where the plugin
runs.

## Tables of its own

| field | type | meaning |
|---|---|---|
| `nick` | string | The owner of the tables `plugin_<nick>_…`. Lowercase letters, digits and `_`, starting with a letter. **Without a nick the plugin cannot write at all.** |
| `schemaVersion` | integer | The version of the table structure the code expects. The core migrates up to it before mounting, and refuses a plugin whose tables are *ahead* of its code (a rollback). |

See [Data](04-data.md) for what a nick gives and what it costs.

## Permissions

`permessi` lists what the plugin asks the core for. Four entries change what
the plugin receives; the others document intent (they appear in reviews and
will gate doors as the SDK grows):

| permission | effect |
|---|---|
| `google:oauth` | `ctx.google` carries the Google OAuth client of the installation (`enabled`, `clientId`, `clientSecret`), in the commercial edition. Without it, `ctx.google` is `null`. |
| `plugins:strumenti` | `ctx.plugins.strumenti()` lists the **tools** other plugins offer. Without it, `ctx.plugins` is `null`. See [tools](07-core-doors.md#tools-shared-between-plugins). |
| `timesheet:write` | `ctx.timesheet` adds hours to people's timesheets. Without it — or on a core without the `timesheet` function (community) — `ctx.timesheet` is `null`. See [timesheet](07-core-doors.md#timesheet). |
| `mail:send` | `ctx.mail` sends email through the core's channel. Without it, `ctx.mail` is `null`. See [mail](07-core-doors.md#mail). |
| `tasks:read`, `projects:read`, `deals:read`, `tickets:read`, `timesheet:read`, `attachments:read`, `contacts:read`, `groups:write` | declarative today. |

## In the interface: `ui`

| field | type | default | meaning |
|---|---|---|---|
| `voce` | string | `nome` | **Menu label.** |
| `icona` | string | `puzzle` | An icon of the application's set (`puzzle`, `bot`, `share-2`, `columns-3`, …) **or a file** in the static folder (`icona.svg`): monochrome, the application tints it with the text colour. A missing file falls back to the puzzle, and the log says so. |
| `menu` | boolean | `true` | Show an entry in the main menu. Contextual plugins (a map opened from a project) say `false`. |
| `sezione` | string | `aree` | **Section**: `aree` (the work areas) or `amministrazione` (administration). |
| `dopo` | string | — | **After**: the key of a core area (`home`, `personal`, `tasks`, `deals`, `projects`, `tickets`, `timesheet`, `contacts`, `help`) or the name of another plugin. Missing: at the end. |
| `ruoli` | string[] | all internal | **Roles** who see the entry: `ADMIN`, `MEMBER`. Customers of the portal never see plugins. |
| `soloManager` | boolean | `false` | Only for people who lead a group or a project. |
| `soloGruppo` | boolean | `false` | **Only the group**: only members of the plugin's own group (see [groups](07-core-doors.md#groups)) — and administrators, who are the ones putting people in it. Anchors stay visible to everyone. |
| `barra` | object | — | **A button in the top bar**: `{ icona, stato, pannello }`. See [the bar button](05-pages.md#the-bar-button). |

## Anchors

`anchors` says **which part of the application the plugin is a child of**:
where its page can be opened from, and with which query string.

```json
"anchors": { "project": true, "task": true }
```

| anchor | where | opens with |
|---|---|---|
| `project` | the ⋯ menu of a project page | `?progetto=<projectId>` |
| `profile` | the profile menu | — |
| `deal` | a button among the attachments of a deal | `?offerta=<dealId>` |
| `docx` | a button on a `.docx` attachment | `?allegato=<attachmentId>&task=<taskId>` |
| `task` | a panel inside the task detail | `?task=<taskId>` |
| `dashboard` | a tile on the dashboard | `?ancora=dashboard` |
| `dashboardGroups` | a third pill in the dashboard groups | `?ancora=dashboardGroups&gruppo=<key>` |
| `deals`, `boards`, `personal`, `timesheet` | the ⋯ menu of those pages | — |

An anchor says **where** the page opens, never **what** the person may do:
the page asks the core for permissions (`ctx.perimeter`, `ctx.tasks.read`…).
See [Pages](05-pages.md#anchors).

## Public paths and health

Every route under `/plugins/<nome>/` goes through the **session guard** of the
core: without a session it answers 401 before reaching the plugin. The
exceptions are declared in `pubblici`, a list of path prefixes relative to the
plugin, optionally with a method in front:

```json
"pubblici": ["OPTIONS /", "POST /", "/.well-known/", "/oauth/token"]
```

This is for protocols that authenticate on their own (an OAuth server, an MCP
endpoint with bearer tokens, a webhook with a signature). **A public path must
authenticate by itself**, or it is open to the world.

`health` is a path that answers without a session: `{ ok: true, version }` is
enough. Monitoring and the installation scripts call it.
