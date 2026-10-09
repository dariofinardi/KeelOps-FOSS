# The context and create()

`plugin.mjs` exports two things: `manifest` and `create(ctx)`. The core calls
`create` once, at start-up, with the **context** — everything the plugin may
use from the core — and mounts what it returns.

```js
export async function create(ctx) {
  return {
    routes: [/* [method, regexp, handler] */],
    staticDir: "/absolute/path/to/ui",
    migrate: (db, from) => { /* bring own tables to manifest.schemaVersion */ },
  };
}
```

`create` may be `async`. It runs **before** the core prepares the plugin's
tables: don't read or write your own tables inside `create` — do it at the
first request (see [Data](04-data.md#when-the-tables-exist)).

## What create() receives: ctx

| field | type | what it is |
|---|---|---|
| `db` | driver | The database driver: reads the KeelOps database, and writes the plugin's own tables when it has a `nick`. See [Data](04-data.md). |
| `sessionUser(req)` | `async → User \| null` | The real authentication of KeelOps: the person behind the request, or `null`. |
| `dataDir` | string | A folder of the plugin's own under the installation's data directory: files, caches, the extension store. It survives updates; the application folder does not (and is read-only in production). |
| `publicUrl` | string | The plugin's public address, `https://…/plugins/<name>` — for links in emails, OAuth redirects, anything that leaves the browser. |
| `keelopsUrl` | string | The public address of KeelOps itself. |
| `ollamaUrl` | string \| null | The local models server, if configured (both editions). Pass it to `ollama.mjs`. |
| `edizione` | string | `"commerciale"` or `"community"`. [→](#edition-and-functions) |
| `funzioni` | Set | The functions of this core, by name. [→](#edition-and-functions) |
| `sdkDir` | string | Where the SDK lives: load its modules from here. |
| `pluginsDir` | string | Where the plugins live (a pro edition loads its free base from here). |
| `tasks` | object | Create and read tasks with the core's rules. [→](07-core-doors.md#tasks) |
| `attachments` | object | Read and write attachments with the core's rules. [→](07-core-doors.md#attachments) |
| `perimeter` | object | `canEditTask(userId, taskId)`: the core's own permission check. [→](07-core-doors.md#permissions) |
| `groups` | object | Own a group of people. [→](07-core-doors.md#groups) |
| `plugins` | object \| null | `strumenti()`: the tools other plugins offer. Only with the `plugins:strumenti` permission. [→](07-core-doors.md#tools-shared-between-plugins) |
| `segnali` | object | `invia(userId, data)`: refresh something in that person's browser, now. [→](07-core-doors.md#signals) |
| `google` | object \| null | The Google OAuth client, only with the `google:oauth` permission and in the commercial edition. |

### Edition and functions

`ctx.edizione` says which edition is running; `ctx.funzioni` is a read-only
`Set` of what this core has: the commercial modules by name (`ticket`,
`timesheet`, `indice-modelli`, `note-di-rilascio`, `analisi-offerte`,
`integrazioni`, `modulo-iniettabile`, `area-investitori`) and `ollama` when
the local models server is configured, in either edition. On a community core
without Ollama the set is empty.

Adapt to it rather than to the edition name: a door that depends on a
missing function is `null` (`ctx.timesheet` without `timesheet`, `ollamaUrl`
without `ollama`), and the data behind it is not there either — a plugin that
would show "0 requests" on a core without tickets is saying something false.
Hide what has no data.

Hours are a special case: the timesheet **grid** (people log hours on tasks) is
in every edition, so `TimeEntry` always has meaning. The `timesheet` function is
the commercial timesheet on top of it — suggestions, reports, productivity,
absences, and the door that lets a plugin add hours.

```js
const hours = ctx.funzioni.has("timesheet");   // show the hours column?
```

To refuse to start without something, say it in the manifest
(`richiede`, see [editions](02-manifest.md#editions)) instead of checking here.

### The user

`ctx.sessionUser(req)` returns:

```js
{
  id: "ckx…",            // User.id
  name: "Anna",          // the nickname, or the full name
  role: "MEMBER",        // "ADMIN" | "MEMBER"
  elevated: false,       // an administrator who has elevated their session («super admin»)
  canViewAllTimesheets: false,
  locale: "it",          // the language chosen in KeelOps, or null
}
```

Only internal people reach a plugin: customers of the portal and sales
monitors get `null`. An administrator is `role: "ADMIN"`; the powerful
actions of KeelOps require `elevated: true` too — follow the same rule for
yours.

## What create() returns

| field | type | meaning |
|---|---|---|
| `routes` | array | `[method, regexp, handler(req, res, match, url)]`, tried in order. The path is relative to the plugin. |
| `staticDir` | string | A folder served as it is for `GET` requests no route matched; `/` serves `index.html`. |
| `wellKnown` | string[] | OAuth documents (`oauth-authorization-server`, …) to also expose at the root in the *path insertion* form of RFC 8414: `/.well-known/<doc>/plugins/<name>`. |
| `migrate` | `async (db, from)` | Brings the plugin's tables from version `from` to `manifest.schemaVersion`. Required when the plugin has a `nick` and a `schemaVersion > 0`. |
| `strumenti` | array | **Tools** the plugin offers to other plugins. [→](07-core-doors.md#tools-shared-between-plugins) |
| `riepilogoMattutino` | `async ({ oggi })` | Lines for the **morning digest** email. [→](07-core-doors.md#the-morning-digest) |

### Routes

```js
routes: [
  ["GET",  /^\/api\/items$/,        list],
  ["GET",  /^\/api\/items\/([^/]+)$/, detail],     // match[1] is the id
  ["POST", /^\/api\/items$/,        create],
],
```

- The dispatcher tries the routes **in order** and stops at the first whose
  method and regexp match. Then the static folder, then a 404.
- `url` is a `URL`: read the query with `url.searchParams.get("q")`.
- **Bodies arrive untouched**: the core does not parse them. Read them with
  `readBody(req)` or `readJson(req)` from `http.mjs` (1 MB limit by default;
  pass your own for uploads).
- An exception in a handler becomes a `500 { errore: "errore interno" }` and
  one line in the log with the method, the path and the message — never the
  body. Answer errors yourself for the ones the person should read.

A pattern that keeps handlers short — authenticate once, turn thrown
`HttpError`s into answers:

```js
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const guarded = (handler) => async (req, res, match, url) => {
  try {
    const user = await ctx.sessionUser(req);
    if (!user) return json(res, 401, { error: "a KeelOps session is required" });
    await handler(user, req, res, match, url);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    throw err;   // the dispatcher logs it and answers 500
  }
};

routes: [["GET", /^\/api\/items$/, guarded(async (user, req, res) => json(res, 200, await list(user)))]];
```

## One process, one lifetime

`create` runs once. A plugin that starts a timer (a nightly job, a cache
refresh) keeps it for the life of the process: **call `.unref()` on it**, so
it never keeps the server alive on shutdown. A plugin switched off from the
System page stops answering at once, but its timers stop only at the next
restart — check at the top of a timer whether there is still work to do.
