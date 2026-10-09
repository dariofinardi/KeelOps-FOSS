# SDK reference

Every module of `keelops-sdk/`, every export. The modules are plain ES
modules with no dependencies; load them from `ctx.sdkDir`:

```js
const sdk = (file) => import(pathToFileURL(join(ctx.sdkDir, file)).href);
const { json, readJson } = await sdk("http.mjs");
```

## database.mjs

### The driver (`ctx.db`)

| member | returns | notes |
|---|---|---|
| `dialect` | `"sqlite" \| "mariadb"` | |
| `nick` | string \| null | the owner of the writable tables |
| `all(sql, ...params)` | `Promise<object[]>` | every row; reads only |
| `get(sql, ...params)` | `Promise<object \| undefined>` | the first row |
| `run(sql, ...params)` | `Promise<{ changes }>` | one write, on `plugin_<nick>_…` only |
| `close()` | `Promise<void>` | a borrowed connection is not closed |
| `sql` | object | the dialect helpers below |

### Dialect helpers (`db.sql`)

| helper | returns SQL for |
|---|---|
| `now()` | the current instant, UTC |
| `today()` | today, `YYYY-MM-DD` |
| `dayOf(expr)` | the day of a timestamp, `YYYY-MM-DD` |
| `monthOf(expr)` | the month of a timestamp, `YYYY-MM` |
| `daysBetween(a, b)` | days from `a` to `b` (fractional) |
| `todayPlusDays(n)` | the date `n` days from today; `n` must be an integer |
| `concat(...parts)` | string concatenation |
| `ident(name)` | a quoted identifier |
| `upsert(key, columns)` | the insert-or-update clause after `INSERT … VALUES (…)` |
| `createTableSuffix()` | what follows `CREATE TABLE (…)` (charset on MariaDB) |
| `longText()` | a text type with no practical bound |

### Functions

| function | returns | what |
|---|---|---|
| `applyMigrations(db, nick, steps, from = 0)` | `Promise<number>` | runs `steps` (`[{ version, up: async (db) => … }]`) above `from`, in order, writing `schema_version` after each; returns the version reached |
| `pluginConfig(db, nick)` | config | the key/value table `plugin_<nick>_config`: `table`, `ensure()`, `get(name) → string \| null`, `set(name, value)`, `all() → { name: value }` |
| `prepareOwnedTables(db, { nick, schemaVersion, migrate, version })` | `Promise<number>` | what the core does before mounting; for the standalone mode and tests |
| `openWritableSqlite(path, nick)` | driver | a writable SQLite driver with the same gate; **for a copy of the database** |
| `borrowedDriver({ dialect, query, execute?, close?, nick? })` | driver | a driver over someone else's connection (the core uses it) |
| `readOnlyQuery(path)` | `(sql, params) => rows` | a read-only query function over a SQLite file |
| `openDatabase(target)` | driver | a read-only SQLite driver from a path or `sqlite:` URL |

## http.mjs

| function | what |
|---|---|
| `json(res, status, body, headers?)` | answers JSON |
| `html(res, status, body, headers?)` | answers HTML |
| `readBody(req, limit = 1_000_000)` | `Promise<string>`: the body, refused above `limit` bytes |
| `readJson(req)` | `Promise<object>`: the body parsed, `{}` when empty |
| `createDispatcher({ routes, staticDir?, name })` | `(req, res, pathWithQuery) => Promise`: the one routing logic, used by the core and by the standalone mode |
| `startServer({ port, routes, staticDir?, name })` | a standalone HTTP server on the given port, listening on the loopback interface only |

A route is `[method, regexp, handler(req, res, match, url)]`. No match: the
static folder, then `404 { errore: "non trovato" }`. An exception: `500
{ errore: "errore interno" }` and one log line.

## ui.mjs

| export | what |
|---|---|
| `BASE_CSS` | the application's look: tokens (`--carta`, `--inchiostro`, `--tenue`, `--filo`, `--rilievo`, `--accento`, `--accento-fondo`, `--pericolo`, `--raggio`, `--font`), imported from `/api/tema.css` with fallbacks |
| `CARD_CSS` | a centred single-card page |
| `ICONS` | inline SVG glyphs: `copia`, `conferma`, `nega`, `revoca`, `indietro`, `entra`, `grip`, `comprimi`, `esterno` |
| `TEMA_SCRIPT` | the theme follower, as text — served to every plugin as **`sdk/tema.js`** |
| `FRAME_RESIZE_SCRIPT` | the frame height reporter, as text — served as **`sdk/riquadro.js`** |
| `TRADUZIONI_SCRIPT` | the translation mechanism, as text — served as **`sdk/traduzioni.js`** |
| `avviaRiquadro()` | the height reporter as a function, for bundled pages that cannot load scripts |
| `avviaTraduzioni()` | the translation mechanism as a function |
| `FRAME_EMPTY_MESSAGE` | `"keelops:vuoto"`: the message a panel sends when it has nothing to show |

### In the browser: `sdk/traduzioni.js`

| global | what |
|---|---|
| `KeelOpsI18n.crea(catalogues, { titolo? })` | installs the translations; `catalogues` is `{ en, fr, de, es }`, Italian is the key; returns `i18n` |
| `i18n.imposta(locale)` | sets the language (the person's choice in KeelOps) and re-translates the page |
| `i18n.lingua()` | the current language |
| `i18n.applica()` | re-translates `data-i18n*` elements (after adding some) |
| `t(key, values?)` | a translated phrase; `{name}` replaced from `values` |

### Messages between a frame and the host

| message | from | meaning |
|---|---|---|
| `{ tipo: "keelops:altezza", altezza }` | the page | its height (sent by `sdk/riquadro.js`) |
| `{ tipo: "keelops:vuoto", vuoto }` | the page | it has nothing to show (`true`) or has again (`false`) |

## ollama.mjs

| export | returns | what |
|---|---|---|
| `embed({ url, input, model = "bge-m3", batch = 64, timeoutMs = 120000, normalized = true, onProgress? })` | `Promise<number[][] \| null>` | vectors for an array of strings, in batches |
| `chat({ url, model, system?, user, schema?, think = false, numPredict = 512, numCtx?, keepAlive?, timeoutMs = 60000 })` | `Promise<string \| null>` | one answer at temperature zero; `schema` is a JSON Schema for the answer |
| `normalize(vector)` | `number[]` | L2 normalisation |
| `dot(a, b)` | number | dot product (the cosine, for normalised vectors) |
| `EMBEDDING_MODEL` | `"bge-m3"` | the default embedding model |

Every failure is `null`, never an exception.

## extension.mjs

`openExtensionStore(dataDir, { fileName = "extension.duckdb", from })` →
`Promise<store>` — a DuckDB file of the plugin's own. `from: import.meta.url`
tells the SDK where the plugin's `node_modules` are
(`npm i @duckdb/node-api` in the plugin folder). `fileName: ":memory:"` for
tests.

| member | what |
|---|---|
| `dialect` | `"duckdb"` |
| `exec(sql)` | DDL, statements without parameters |
| `all(sql, ...params)`, `get(sql, ...params)` | reads |
| `run(sql, ...params)` | `{ changes }` |
| `migrate(steps, from?)` | versioned schema, the version kept in `keelops_schema`; returns the version reached |
| `version()` | the schema version in the file (0 = none) |
| `close()` | |

## perimeter.mjs

| function | returns | what |
|---|---|---|
| `taskPerimeter(user)` | `{ where, params }` | an `AND` filter over `Task t`: what a person may see, conservatively |
| `projectPerimeter(user)` | `{ where, params }` | a filter over `Project p`: the projects a person is in |

## text.mjs

| function | what |
|---|---|
| `stripHtml(text)` | rich text (HTML) to plain text |
| `escapeHtml(text)` | escapes `& < > " '` for HTML |

## session.mjs

`sessionUser(req, db, cookieName)` → `Promise<User | null>`: the KeelOps
session behind a request, for the **standalone mode** only. Inside the core
use `ctx.sessionUser`.

## sql-targets.mjs

| function | returns | what |
|---|---|---|
| `writeTargets(sql)` | `{ tables, indexes, statements }` | the tables and indexes a statement writes; throws on views, triggers and what it cannot classify |
| `assertWritesOnlyOwnTables(sql, nick)` | `{ tables, indexes }` | the gate: throws unless every written name carries `plugin_<nick>_` and the text holds one statement |
| `stripCommentsAndStrings(sql)` | string | the statement without comments and string literals |

## Italian names in the contract

| name | English | where |
|---|---|---|
| `nome` | name | manifest; tool |
| `titolo` | title | manifest; bar state |
| `versione` | version | manifest |
| `descrizione` | description | manifest; tool |
| `sommario` | summary | manifest |
| `licenza` (`libero`, `commerciale`) | licence (free, commercial) | manifest |
| `permessi` | permissions | manifest |
| `montaCome` | mount as | manifest |
| `pubblici` | public paths | manifest |
| `voce` | menu label | `ui` |
| `icona` | icon | `ui`, `ui.barra` |
| `sezione` (`aree`, `amministrazione`) | section (areas, administration) | `ui` |
| `dopo` | after | `ui` |
| `ruoli` | roles | `ui` |
| `soloManager`, `soloGruppo` | managers only, group only | `ui` |
| `barra` (`stato`, `pannello`) | bar button (state, panel) | `ui` |
| `tono` (`acceso`, `spento`, `bloccato`, `nessuno`), `lampeggia` | tone (on, off, locked, none), blink | bar state |
| `strumenti` (`parametri`, `esegui`) | tools (parameters, run) | `create()`, `ctx.plugins` |
| `segnali.invia` | signals.send | `ctx` |
| `timesheet.aggiungi`, `timesheet.meseChiuso`, `ore`, `nota` | timesheet.add, month closed, hours, note | `ctx` |
| `mail.invia`, `mail.attiva`, `inviata`, `motivo` | mail.send, mail active, sent, reason | `ctx` |
| `riepilogoMattutino` (`oggi`, `righe`) | morning digest (today, lines) | `create()` |
| `chiave`, `origine` | key, origin | groups |
| `saltato`, `sostituito` | skipped, replaced | attachments |
| `imposta`, `lingua`, `applica`, `crea` | set, language, apply, create | translations |
| `ancora`, `progetto`, `offerta`, `allegato`, `gruppo` | anchor, project, deal, attachment, group | query strings |
