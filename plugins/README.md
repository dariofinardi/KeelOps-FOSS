# KeelOps plugins

Plugins are **loaded inside the core process** (side-loaded): one line in the
KeelOps `.env` — `PLUGINS=TasksMap,mcp` — and the plugin host
(`apps/server/src/plugins/plugin-host.ts`) mounts them under `/plugins/<nome>/…`.
No separate processes, no nginx, no tokens: the APIs are **local function
calls**, authentication is the core's real one, and security lives in the
code — every route applies the user's visibility perimeter. The existing HTTP
APIs (the osTicket integration) are unrelated and do not change.

| plugin       | what it does                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TasksMap/`  | the task map of a project: themes, hierarchy, time windows (table `plugin_tasksmap_vettore`)                                                        |
| `Personale/` | everyone's personal kanban boards (tables `plugin_personale_*`)                                                                                     |
| `mcp/`       | MCP server with OAuth2 to connect Claude, ChatGPT, Mistral                                                                                          |
| `MCP-pro/`   | the pro version of the connector, in a separate repository (linked here with a symlink)                                                             |
| `Presenze/`  | the attendance and absence calendar: the interface to the core's absence register (`Absence`, `/api/absences`); same separate repository as MCP-pro |

## keelops-sdk

**The documentation for plugin authors** is in `keelops-sdk/docs/` (since
24/09/2026): eleven chapters in English — first-plugin guide, manifest,
context, data, pages, local AI, core ports, rules, testing and release,
complete API reference — also published at keelops.it/sdk/docs/. This file
remains the **contract**, with the reasoning behind the choices; when something
changes here, it changes there too. The guide's example is actually run by
`apps/server/test/sdk-docs-example.test.ts`.

`keelops-sdk/` is the **plugin SDK**: the modules every plugin imports with a
relative path, nothing to install. It contains the **database abstraction**
(`database.mjs`: a driver with **asynchronous** `all`/`get`/`close` and the
dialect quirks behind `db.sql.*`). There are two drivers: `openDatabase(percorso)`
opens the SQLite file on its own, read-only and with a busy timeout to coexist
with WAL; `borrowedDriver({dialect, query})` sits on top of **someone else's**
connection — the core's, which already talks to the right engine — and uses it
without needing to know how to connect. Borrowing has a price: that connection,
unlike ours, could write, so the borrowed driver **rejects anything that is not
a SELECT**, and returns rows in the usual shape (dates as ISO strings,
`COUNT()` as numbers instead of BigInt, which `JSON.stringify` would reject).

The interface is **asynchronous**, and it is worth saying why, given that a
SQLite read answers in a tenth of a millisecond: `node:sqlite` answers
synchronously, every MariaDB client for Node answers with a promise, and no
abstraction turns one into the other. Making the fast case wait costs nothing
and is the only shape that fits both. It cost `await` in 41 places across the
two plugins: "one driver file and one registry entry", as this paragraph used
to say, was an optimistic forecast.

The rest of the SDK: the HTTP engine driven by a route table (`http.mjs`: a
single dispatcher for side-loaded and standalone mode), text cleanup
(`text.mjs`), session recognition for standalone mode (`session.mjs`), the
conservative visibility perimeter (`perimeter.mjs`), the extension store
(`extension.mjs`) and **the KeelOps look** (`ui.mjs`: `BASE_CSS`, which since
07/09/2026 **inherits the application's colors** — its first line pulls in
`/api/tema.css`, which the core generates from the same source as the
interface (`packages/shared/src/tema.css`), **already resolved** for the viewer:
light, dark, or the media query if they chose "automatic". The historical names
(`--carta`, `--inchiostro`, `--filo`, `--rilievo`, `--accento`) remain, mapped
onto the core's tokens, and the usual values act as a fallback where the core's
stylesheet cannot be reached (plugin in standalone mode).
**The theme is the one the person is looking at**, not the operating system's:
`TEMA_SCRIPT` watches the `dark` class of the document hosting the frame — same
origin — and mirrors it onto `data-tema` on `<html>`, following it as it
changes. Pages with their own colors write them under `[data-tema="dark"]`,
never inside `prefers-color-scheme`. It is served as `base.css`, with a twin
route `tema.js` for the script; a server-rendered page puts them in its head
(`<style>${BASE_CSS}</style><script>${TEMA_SCRIPT}</script>`). **This applies to
all plugins, free and paid**: TasksMap, Personale, the MCP connector (its five
pages, OAuth consent included), MCP-pro and Presenze — none of them looks at
`prefers-color-scheme` any more, except as a fallback when the page is opened
on its own and there is no application to follow. The system font, `CARD_CSS`
for centered-card pages, `ICONS` with the app's lucide glyphs — server-rendered
pages interpolate them, a static UI serves `BASE_CSS` from a small route and
links it, like TasksMap's `/base.css`). No webfonts, on purpose: the product
uses system fonts.

**Language convention:** in plugin code — functions, methods, comments — write
in **English**. User-facing text (pages, messages, captions) stays in Italian.

## The plugin contract

Each `plugins/<nome>/` folder exposes `plugin.mjs`:

```js
export const manifest = {/* nome, versione, permessi, ui, salute */};
export function create(ctx) {
  return { routes, staticDir, wellKnown }; // table-style routes
}
```

(Manifest keys are Italian: `nome` (name), `versione` (version), `permessi`
(permissions), `salute` (health).)

`ctx` comes from the core: `db` (read-only; a plugin that declares a `nick`
writes to its own tables, see below), `dataDir`, `keelopsUrl`, `ollamaUrl`,
`publicUrl`, `sessionUser(req)` (the real authentication, asynchronous).
Since 22/09/2026, **tasks**: `tasks.create(userId, { title, description?, projectId?, assigneeId?,
supervisorId?, dueDate?, statusId?, activityTypeId? })` creates a task through the core's service
(`createTaskAs`), and therefore with its rules — the creator's permission, the category's initial
status, the default contact, notifications, activity log — and in the demo it does not write;
`tasks.read(userId, taskId)` and `tasks.readMany(userId, ids)` read it back with the core's
visibility perimeter: what that person would not see comes back as `null`, **not an error**. A
plugin never writes to `Task` by itself: the gate prevents it, and that is the reason this port
exists.
Since 22/09/2026 also **groups**: `groups.ensure({ chiave, nome, area? })` creates, **once**, that
plugin's group — the people who do that job — and returns it; `groups.read(chiave)` finds it again (or
`null` if it no longer exists), `groups.members(chiave)` says who is in it. The identity is the pair
(plugin nick, `chiave` (key)), **never the name**: the administrator can rename it at any time and the
plugin still finds it. If a group with that name already exists and nobody claims it, `ensure`
**adopts** it instead of creating a second one — members are left untouched. If someone deletes it,
the plugin **does not resurrect it**: it notices through `read` and says so on the page. In the
manifest, `ui.soloGruppo: true` removes the menu entry for people who are not in the group (anchors
remain for everyone: someone who has been assigned an action must be able to read where it comes
from).

### The card in System, and the switch

Since 23/09/2026 the **System** page lists for the super admin every plugin in
the folder: the mounted ones and those present but not installed (read from
their `manifest.json`). From the manifest it uses `titolo` (title), `versione`,
`schemaVersion`, `licenza` (license) and two fields designed for this:

- `copyright` — one line, as it should be printed: `"© 2026 Jugaad s.r.l."`;
- `sommario` (summary) — one sentence per language, `{ it, en, fr, de, es }`:
  the page shows it in the reader's language, then English, then Italian.
  Without `sommario`, the first sentence of `descrizione` (description, in
  Italian) is used.

From there an installed plugin can be **switched off and on again live** (the
choice is stored in `AppSetting` `plugins.disattivati`). When off: its routes
and well-knowns answer 404 `PLUGIN_DISABLED`, it disappears from
`/api/plugins/ui` (menu and anchors) and from the morning digest. **Tables and
data remain**, and `create()` is not called again: timers the plugin started
stop only at the next restart. Installing is a different thing: `installa.sh`
and a restart.

### Editions: `edizione`, `richiede`, `usa`

Since 08/10/2026 KeelOps has two editions, community and commercial. The plugin
sees them in `ctx.edizione` and `ctx.funzioni` (the set of modules present,
plus `ollama`); ports that depend on a missing module are `null`
(`ctx.timesheet`, `ollamaUrl`). In the manifest:

- `edizione: "commerciale"` (edition) — not mounted on a community core;
- `richiede: ["timesheet", …]` (requires) — not mounted if any of those features is missing;
- `usa: [...]` (uses) — mounted anyway and adapts: it is information, not a check.

A plugin listed in `PLUGINS` that is not mounted because of the edition says so
in the log and on its card in System ("Not available in this edition", with
the reason). Today: Presenze, QABox, QuoteDOCX, Rapportini and MCP-pro are
`commerciale`; TasksMap `usa` the models, mcp the hours statistics and tickets
when they are there. Hours as such are always there: the timesheet grid belongs
to the core (08/10/2026); the `timesheet` feature is the full commercial
timesheet. The guide for plugin authors is in `keelops-sdk/docs/02-manifest.md`.

### The tunnel between plugins: tools

Since 23/09/2026 a plugin can **offer tools** to the others: `create()` also
returns `strumenti` (tools), a list of

```js
{ nome: "cruscotto",                       // lowercase, digits, _ (max 49)
  descrizione: "…for a language model…",
  parametri: { type: "object", properties: { … } },   // JSON Schema
  esegui: async (utente, parametri) => risposta }     // utente: the one from ctx.sessionUser
```

and a plugin that asks for **`plugins:strumenti`** in its manifest finds them
with `ctx.plugins.strumenti()` (a plugin that does not ask gets
`ctx.plugins === null`). Each tool comes out prefixed with the offering
plugin's name (the nick, or the name: `qabox_cruscotto`) and with
`esegui(userId, parametri)`. Three rules, and they are why the tunnel goes
through the core:

- **declared, not scanned**: of a plugin you see only what it offers; access
  checks stay inside its `esegui`;
- **the core sets the identity**: the caller passes an id, and the callee
  receives the user read from the database (active and internal) — or an error;
- **a switched-off plugin disappears from here too**, and the registry is read
  at call time: the order of `PLUGINS` does not matter.

Today it is used by QABox (offers its records, read-only) and MCP-pro (makes
them available to assistants).

### The button in the bar, and signals

`ui.barra: { icona, stato, pannello }` (bar: icon, status, panel) puts a button
in the top bar, between the bell and the profile. `icona` is a file in the
static folder (monochrome, as for the menu) or a name from the icon set;
`stato` is a plugin route that answers `{ tono, lampeggia, titolo }` — `tono`
(tone) among `acceso` (green), `spento` (grey), `bloccato` (amber) and
`nessuno`, `lampeggia` makes the dot blink, `titolo` is the tooltip, already
translated; `pannello` is a plugin page, opened in a popover under the button
(`sdk/riquadro.js` gives it the right height).

The core re-reads the status every minute, when the panel closes and when the
plugin asks for it with **`ctx.segnali.invia(userId, dati)`**: an event on the
core's real-time channel, to that person only, which makes their button re-read
it. No queue: whoever is not connected does not receive it.

### The mark: what a plugin leaves in the core

**Every row a plugin creates in a core table carries its name** (22/09/2026).
`Group`, `Task` and `Attachment` have `pluginNick` (who requested it) and
`pluginRef` (the record's id inside the plugin, or the group key). **The core
sets** the nick, binding each port to the plugin that receives it: no plugin
can sign with another's name, and a plugin passing a `ref` is only saying what
it corresponds to on its side.

It serves uninstallation, which does not exist yet: the day a plugin can be
removed, the question "what does it leave behind?" will have an answer in
numbers (`inventarioDelPlugin(nick)` already gives it) instead of a shrug, and
whoever uninstalls can choose whether to keep the rows, remove their mark or
delete them. A row **the plugin did not create** is not marked: an NC attached
to a ticket that came from the portal leaves the ticket as it was.

Since 21/09/2026 `perimeter.canEditTask(userId, taskId)` (the core's predicate, plain: a denied
permission is not a failure) and `attachments.write(userId, taskId, { name, mimeType, bytes, replaceAttachmentId? })`,
which creates — or **replaces keeping the same id**, if the attachment belongs to that task — a FILE
attachment on behalf of the user: the core's rule applies (whoever can edit the task can attach), in
the demo it does not write, and the activity goes into the log like any other upload.
Since 05/09/2026 also `attachments.read(userId, attachmentId, { bytes? })`: the
core applies **its own** access rule (whoever sees the task reads the file) and
delivers name, type, size, the address for links, the extracted text (PDF,
Word, text files) and — if requested and under 8 MB — the bytes. Outside the
core (standalone plugin) the function is not there: the plugin says so.
`wellKnown` lists the OAuth documents to expose also in the insertion form of
RFC 8414.

**Every route under `/plugins/<nome>/` goes through the core's session guard**
(since 05/09/2026): without a session it answers 401 before even reaching the
plugin. The manifest declares the exceptions in `pubblici` (public), a list of
prefixes relative to the plugin's root, with a method in front if needed — for
`mcp`: `["OPTIONS /", "POST /", "DELETE /", "/mcp", "/.well-known/", "/oauth/register",
"/oauth/authorize", "/oauth/token", "/oauth/revoke"]` (the protocol and OAuth
authenticate themselves, with the bearer). The `health` path is public by
itself. The plugin still calls `sessionUser(req)` where it needs the user: the
guard says _whether_ you get in, not _who_ you are.

**Reads go through a connection that cannot write**: on SQLite a second,
read-only access to the file, on MariaDB a `READ ONLY` session of the engine.
The gate on the statement text (`sql-targets.mjs`) stays for the readable
error, not as the only defense. Writes from a plugin with a nick go on the
core's connection, with the mandatory prefix.

The **manifest** can declare the plugin's presence in the core's interface:
`ui: { voce, icona }` (entry, icon) becomes a menu entry after the areas (icon
from the lucide set already in use: `share-2`, `bot`, `columns-3`, or the
fallback `puzzle` — or **a file of the plugin**, `icona: "icona.svg"`, looked up
in its static folder: a monochrome SVG, which the core tints with the text color
like the others), rendered inside AppShell in a same-origin iframe
(`/estensioni/<nome>`); `anchors` declares **which feature the plugin is a child
of** — `{ project: true }` for TasksMap (the three-dot menu on the project page,
which opens it with `?progetto=<id>`), `{ profile: true }` for the MCP connector
(the user profile menu), `{ deal: true }` for plugins that write the document
of a **single deal** (QuoteDOCX: the "Word" button after Drive, Link and File in
the deal's attachments, for those who can edit it, opens the plugin with
`?offerta=<id>`; since 21/09/2026, see "A dedicated button for an anchor"),
`{ docx: true }` for plugins that can **open an attached .docx** (the Word
button on the attachment row, for those who can edit the task, opens the plugin
with `?allegato=<id>&task=<id>`: the plugin gets it from
`ctx.attachments.read(..., { bytes: true })`, imports it and writes it back in
its place with `ctx.attachments.write`); `{ task: true }` for plugins that
generate work and want to say **where a task comes from** (QABox: "corrective
action for NC-41", a box inside the detail panel, opened with `?task=<id>`;
since 22/09/2026); the possible areas today: `project`, `profile`, `deal`,
`deals`, `docx`, `task`, `boards`, `personal`, `timesheet`. Each page declares
its own area by mounting the menu, and a menu with no plugins for its area does
not appear. `ui.menu: false` keeps the plugin out of the main menu (the sensible
default for contextual plugins). The core discovers everything from
`GET /api/plugins/ui`.

## Own data: the plugin's tables

Since 05/09/2026 a plugin **can own tables** in the KeelOps database, and is
fully responsible for them: it creates them, migrates them, maintains them. It
declares a `nick` in the manifest (lowercase, digits, underscore: `personale`)
and from then on its tables are named `plugin_<nick>_<tabella>`. Nothing else
is allowed: the driver it receives lets a write through only if **every** table
written carries its prefix, and it decides by reading the statement
(`keelops-sdk/sql-targets.mjs`), not the first word — `WITH x AS (…) DELETE
FROM Task` starts with `WITH` and is valid SQLite. The rejection says which
name stopped it. This also applies to `all()`/`get()`: a disguised read does
not get through.

```js
export const manifest = { nome: "Personale", nick: "personale", versione: "1.0.0", schemaVersion: 1, ui: { … } };
export function create(ctx) {
  return {
    routes, staticDir,
    migrate: (db, from) => applyMigrations(db, "personale", [
      { version: 1, up: (d) => d.run("CREATE TABLE plugin_personale_board (…)") },
    ], from),
  };
}
```

Three things the core requires **before mounting** a plugin with a nick:

1. **`plugin_<nick>_config` exists, and comes first.** Key/value for the
   plugin's settings, plus two rows that are not optional: `plugin_version`
   (the code that last wrote) and `schema_version` (the structure of its
   tables). The core creates it empty if missing
   (`pluginConfig(db, nick).ensure()`), and the System page shows it.
2. **The structure in the table is not ahead of the code.** If it is — a
   plugin rolled back — the core does not mount it, instead of letting it run
   on tables it does not understand.
3. **If it is behind, `migrate(db, from)` brings it to `schemaVersion`**, and
   after the call the table MUST say that number. The SDK's `applyMigrations`
   applies the missing steps in order and writes `schema_version` after
   **each one**: a step that fails halfway leaves the version of the last
   successful one, which is the truth (on MariaDB a DDL commits by itself:
   "all in one transaction" is not a promise a neutral layer can keep).

Foreign keys go one way only: from the plugin to the core
(`ownerId → User.id`, with `ON DELETE CASCADE`), never from the core to a
plugin — a switched-off plugin must not break a deletion. DDL is written
behind `db.sql.*` or in strict ANSI, and tested on the other engine with
`apps/server/scripts/mariadb/prova-plugin.ts --database <db di prova>`. The
SQLite→MariaDB transfer copies `plugin_%` tables by name
(`scripts/mariadb/migra-dati.ts`): the plugin creates the destination on first
start.

DDL for text with no practical limit (extracted documents, vectors as JSON)
uses `db.sql.longText()`: `TEXT` on SQLite has no ceiling, on MariaDB it is
64 KB, and the same DDL fit on one side and was truncated on the other.

In standalone mode a plugin with tables cannot use the driver that opens the
file read-only: the SDK gives it `openWritableSqlite(percorso, nick)` — the
borrowed driver on top of a writable `node:sqlite`, with the same gate — and
`prepareOwnedTables(db, { nick, schemaVersion, migrate, version })`, which does
what the core does before mounting it. Always on a **copy** of the database.

The **DuckDB** in `data/` (`keelops-sdk/extension.mjs`) remains for the
plugin's throwaway or analytical data — caches, computed graphs, volumes that
can be rebuilt — not for data that matters. Since 06/09/2026 it is a real API,
shaped like the database driver: `openExtensionStore(dataDir, { from:
import.meta.url })` gives `exec` (DDL), `all`/`get`/`run` with positional `?`,
`migrate([{ version, up(store) }])` with the version kept in the file
(`keelops_schema`), `version()`, `close()`; rows come back flat (BIGINT as
number, dates and decimals as strings). The `@duckdb/node-api` module must be
installed **in the plugin's folder** and `from` tells the SDK where to look
for it. State in `plugins/*/data/` is protected from deploys (excluded from
rsync, like `/data`).

## Everything goes through the SDK

A plugin **does not access** anything of the core by itself: it does not open
the database (neither `node:sqlite`, nor Prisma, nor a MariaDB client), does
not read the `.env`, does not call the services the core lends. The database
is the `ctx.db` driver; attached files are `ctx.attachments.read`; Google
credentials are `ctx.google`; **timesheet hours** are added with
`ctx.timesheet.aggiungi` (permission `timesheet:write`) and **mail** goes out
with `ctx.mail.invia` (permission `mail:send`), since 29/09/2026 for the work
reports — never an SMTP of its own, never a write to `TimeEntry`;
**Ollama is `keelops-sdk/ollama.mjs`** (`embed`, `chat`, `normalize`, `dot`)
with the address from `ctx.ollamaUrl` — a failure is `null`, never an
exception, as in the core. The allowed exceptions are the plugin's own data
(`ctx.dataDir`) and integrations that belong _to the plugin_ (Drive for
MCP-pro, with the credentials the core lends it). A test in the core
(`test/plugins-through-sdk.test.ts`) reads the plugins' sources and stops on a
forbidden import.

## The menu entry, and anchors with content

`ui` in the manifest also says **where** to sit and **who** sees it: `sezione`
(section: `aree` or `amministrazione`), `dopo` (after: the key of an area —
`home`, `personal`, `tasks`, `deals`, `projects`, `tickets`, `timesheet`,
`contacts`, `help` — or the name of another plugin; absent = at the end),
`ruoli` (roles: `["ADMIN", "MEMBER"]`; absent = all internal users),
`soloManager`, `soloGruppo` (since 22/09/2026: visible to members of the
plugin's group, and to the administrator, who is the one who puts people in
it). A value the core does not understand does not break the menu: it falls
back to the default and says so in the log.

### A dedicated button for an anchor

The three-dot menu (`PluginMenu`) is the generic form; where the gesture
deserves a button with its own name and icon — "Word" among the deal's
attachments (21/09/2026) — the recipe is this, in two halves.

**In the plugin** the manifest is enough: `anchors: { deal: true }` says which
feature it is a child of, `ui.menu: false` if it makes no sense in the main
menu (or `menu: true` with `sezione`/`ruoli` if it also has a page of its own,
like QuoteDOCX with its templates). The page reads the reference from the query
string (`?offerta=<id>`) and asks the core via `ctx.db` for the permissions it
needs: the anchor says _where_ it opens, not _what_ can be done.

**In the core**, in the page that hosts the gesture (`AttachmentsSection.tsx` is
the example):

1. `const editori = (usePlugins().data ?? []).filter((p) => p.anchors?.deal)`:
   only the plugins that are children of that anchor; an empty list means **no
   button**, not a disabled button — without plugins the interface does not
   mention it.
2. The same condition as the neighboring buttons (`task.canEdit`, `task.kind ===
TaskKind.DEAL`…): the plugin does not widen the core's permissions.
3. One `Button` per plugin (with several plugins on the same anchor, the label
   is the plugin's `voce`), with an **inline** icon if it is a brand —
   `WordGlyph`, `GoogleDriveGlyph` — because the CSP does not allow external
   assets and lucide has no third-party logos.
4. Open `/estensioni/<nome>?<chiave>=<id>` with a link or
   `window.location.assign`, **not** with `useNavigate`: the section also lives
   in trees without a Router (the dom-tests), as `PluginMenu` already does.
5. A dom-test that fakes `usePlugins` (`vi.mock` with a changeable list) and
   checks three things: without plugins the button is not there; with the
   plugin, in the right context and with the permission, it is there and opens
   the expected address; read-only or in the wrong context it is not there.
6. The new anchor goes into the list above, with who opens it and with which
   query: it is the contract a plugin reads.

No server-side change: `plugin-host.ts` passes `anchors` from the manifest to
`/api/plugins/ui` as it is, without a closed list.

### Page translations

**There is one mechanism, in the SDK** (22/09/2026): `keelops-sdk/ui.mjs`
exports `avviaTraduzioni`, and the shell serves it to every plugin as
`sdk/traduzioni.js`, next to `sdk/tema.js` and `sdk/riquadro.js`. Italian is
the key, the language is the one chosen in KeelOps (`api/me` →
`i18n.imposta(locale)`), a missing sentence falls back to English and then to
Italian, `{nome}` is substituted. The plugin brings **only its catalogs**:

```html
<script src="sdk/traduzioni.js"></script>
<script src="i18n.js"></script>
<!-- KeelOpsI18n.crea({ en: {…}, fr: {…}, de: {…}, es: {…} }) -->
```

Static labels translate themselves with `data-i18n`, `data-i18n-placeholder`
and `data-i18n-title` (which also sets `aria-label`). A page built with Vite
(Personale, QuoteDOCX) keeps its own `i18n.ts`, because it does not load
external scripts; Presenze and TasksMap still have their own copy of the
mechanism, to be moved onto this one. **The five languages besides Italian
(en, fr, de, es, pt) must be kept complete**:
`apps/server/test/plugins-translations.test.ts` reads every plugin it finds and
stops on a sentence without a translation.

An anchor can carry **content**, not just a button: `PluginPanel` in the core
mounts a frame with the plugin's page inside a native page (a plugin's box in
the day view). The page is the usual one, opened with `?ancora=<nome>`; to get
the right height it inserts at the bottom
`<script>${FRAME_RESIZE_SCRIPT}</script>` from `keelops-sdk/ui.mjs`. If it has
nothing to show it says so — `postMessage({ tipo: "keelops:vuoto", vuoto: true })`
to the shell — and the frame disappears from the page instead of remaining an
empty box (`vuoto: false` brings it back; 07/09/2026).

**Cards in the day view's groups** (`anchors.dashboardGroups`, since
06/09/2026): the "Overdue", "Today", "Tomorrow", "Next days", "No due date"
boxes have a third pill, **Personal**, next to Mine and Supervised. The plugin
answers on `GET api/gruppi` with `{ gruppi: { overdue, today, tomorrow, next, none } }`
(the grouping rule is the core's: before today, today, tomorrow, the following
four days, no date) — the numbers on the pills — and, once the pill is chosen,
its page opens inside the box with `?ancora=dashboardGroups&gruppo=<chiave>`,
without a header (that belongs to the box). Without a plugin with that anchor
the pill is not there.

## The morning digest

It is the core's first hook **towards** plugins. The 7:00 digest
(`sendDueDigests`) asks every mounted plugin whether it has lines to add:
`create()` can return `riepilogoMattutino({ oggi })` (morning digest) →
`[{ userId, righe(locale) => string[] }]`, one entry per person who has
something to be told, with the line already written in the language the core
passes (the core knows the recipient's language, the plugin does not). A
single line is enough on its own to trigger the digest. A plugin that answers
badly or does not answer within ten seconds does not stop it: its part is
missing and the log says so. Personale uses it for "Personal boards: 3
overdue, 1 due today".

## Standalone mode

Every plugin also has `server.mjs` (a process of its own, handy in
development) and `selftest.mjs`, the end-to-end test to run **against a copy**
of the database: `node selftest.mjs <copia.db>`. The dispatcher is the same as
in side-loaded mode: the two modes cannot diverge.
