# The KeelOps plugin SDK

KeelOps does a few things and does them well. What only some teams need — a
quote laid out the way the company wants it, the quality inspections of a
manufacturer, attendance, an AI connector — comes as a **plugin**: a folder
of plain JavaScript that the KeelOps server loads into its own process and
mounts under `/plugins/<name>/`.

This documentation is for the people who write those plugins. It explains
how a plugin is put together, what the core lends it, the rules it has to
follow, and every function of the SDK.

## What a plugin is

A plugin is a folder with two things in it:

- `plugin.mjs`, which exports a **manifest** (who the plugin is, where it
  shows up in the interface, what it asks the core for) and a **`create(ctx)`
  function** that returns the plugin's routes;
- whatever the plugin needs to do its job: its own modules, a static page, its
  translations, its tests.

The KeelOps server loads it at start-up when its name is listed in `PLUGINS`
in the server's `.env`:

```bash
PLUGINS=TasksMap,Personale,QABox
```

There is no second process, no reverse proxy, no API token. A plugin's routes
are served by the same server, on the same origin, behind the same session
guard as the rest of KeelOps. Its pages open inside the application — in the
main menu, in a panel, under a button — and they look like the application
because they borrow its stylesheet.

```
Browser ──► KeelOps server (one process)
              ├── core: tasks, deals, projects, tickets, timesheet…
              └── plugin host
                    ├── /plugins/TasksMap/…   create(ctx) → routes
                    ├── /plugins/QABox/…      create(ctx) → routes
                    └── /plugins/mcp/…        create(ctx) → routes
```

## What the core lends, and what it keeps

The core hands every plugin a **context** (`ctx`) when it calls `create()`:
a database driver, the real authentication, and a few narrow *doors* into
the core — create a task, attach a file, own a group of users, offer tools
to other plugins, signal a person's browser.

It keeps everything else. A plugin:

- **reads** the KeelOps database through a connection that cannot write;
- **writes** only in tables of its own, named `plugin_<nick>_…`, which it
  creates and migrates itself;
- touches core records (tasks, attachments, groups) **only through the
  doors**, which apply the core's rules — permissions, notifications, the
  activity log — exactly as if a person had done it by hand;
- never opens a database on its own, never reads the server's environment,
  never calls the local AI models except through the SDK.

These rules are not a convention: the database gate reads every SQL
statement before it runs, and a test in the core reads every plugin's source
and fails on a forbidden import. [Security and rules](08-security.md) explains
each of them and why it exists.

## The SDK

`keelops-sdk/` is a folder of ES modules shipped with KeelOps. There is
nothing to install: a plugin imports the modules from the path the core gives
it (`ctx.sdkDir`), or with a relative path when it lives next to the SDK.

| module | what it gives |
|---|---|
| `database.mjs` | the driver shape, dialect helpers (`db.sql.*`), own tables, migrations, the config table |
| `http.mjs` | the route table, one dispatcher for both modes, JSON and body helpers |
| `ui.mjs` | the KeelOps look (`BASE_CSS`), theme and frame scripts, translations, icons |
| `ollama.mjs` | embeddings and answers from the local models, failures as `null` — see [Local AI](06-local-ai.md) |
| `extension.mjs` | a DuckDB file of the plugin's own, for data it can rebuild |
| `perimeter.mjs` | a conservative task-visibility filter for SQL |
| `text.mjs` | `stripHtml`, `escapeHtml` |
| `session.mjs` | session recognition when the plugin runs on its own |
| `sql-targets.mjs` | the gate: which tables a statement writes |

## How to read this documentation

1. [Getting started](01-getting-started.md) — a first plugin, from an empty
   folder to a page in the KeelOps menu.
2. [The manifest](02-manifest.md) — every field, with examples.
3. [The context and create()](03-context.md) — what the core passes in, what
   the plugin returns.
4. [Data: reading and owning tables](04-data.md) — the driver, the dialects,
   migrations, the extension store.
5. [Pages in the application](05-pages.md) — menu entries, anchors, frames,
   the bar button, theme, translations.
6. [Local AI: reports and release notes](06-local-ai.md) — embeddings and
   answers from the models running on your own server, and how to turn the
   work done into documents people read.
7. [Working with the core](07-core-doors.md) — tasks, attachments, groups,
   tools shared between plugins, signals, the morning digest.
8. [Security and rules](08-security.md) — what a plugin may and may not do.
9. [Testing and shipping](09-testing-and-shipping.md) — the standalone mode,
   the self-tests, the other database engine, installation and updates.
10. [SDK reference](10-reference.md) — every exported function and constant.

## Conventions used here

- **Code, comments and identifiers of a plugin are in English.** What a
  person reads on screen is translated (see
  [translations](05-pages.md#translations)).
- Some names in the contract are **Italian**, because KeelOps was born in
  Italian and renaming them would break every existing plugin: `nome` (name),
  `versione` (version), `voce` (menu label), `strumenti` (tools), `segnali`
  (signals)… Each one is explained where it appears, and the
  [reference](10-reference.md) lists them all.
- Every database call is **asynchronous**. Examples always `await`.
