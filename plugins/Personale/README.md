# Personale — personal kanban boards for KeelOps

A KeelOps plugin: every person gets their own kanban boards — columns of
their choosing, templates, due dates with a time, archiving — separate from
the team's work and visible to nobody else. It used to be a core feature
(`modules/boards/`, `features/boards/`); since 05/09/2026 it is a plugin that
**owns its data**, the first written against the current plugin contract
(`plugins/LEGGIMI.md`, "Dati propri"). The plan, with measurements and checks,
is in `plan/plugin-personale.md`.

## What the user sees

- **Boards as tabs.** The active one is remembered; `?bacheca=<id>` in the
  address opens a given board (that is how the dashboard tile links back).
  A welcome board, «Mia», is created once, at the first visit, and never
  again if deleted.
- **Columns** per board, with a colour, exactly one initial column and at
  least one closing column; five templates (basic, with review, GTD,
  Eisenhower, week). A column that still holds cards cannot be removed.
  The personal order of the columns is a preference of the core's profile
  (`/api/profile/column-order`, key `board:<id>`), the same one the core
  feature used.
- **Cards**: title, description, due date and time, assignee and supervisor
  (internal, active people only). A card is born in the initial column,
  assigned and supervised by whoever creates it. Moving it into a closing
  column stamps `closedAt` once; moving it out clears it. Archiving hides
  without deleting; deleting is for good — personal cards never went
  through the bin.
- **Filters** (06/09/2026): free text over title and description, column,
  due date (overdue / today / this week / none). Remembered per board in the
  browser's `localStorage`, like every filter in KeelOps.
- **Drag and drop** between columns (dnd-kit), a context menu on each card,
  keyboard access to everything.
- **On the dashboard** (the core's "La mia giornata"): a tile with the open
  cards (`anchors.dashboard`), and since 06/09/2026 a third chip, **Personali**,
  next to *Miei* and *Supervisionati* on each deadline group — overdue,
  today, tomorrow, next days, no date — with the count of personal cards in
  that group and, when chosen, the cards themselves inside the tile
  (`anchors.dashboardGroups`).
- **In the morning digest**: a line such as «Bacheche personali: 3 in
  ritardo, 1 in scadenza oggi», in the recipient's language, appended to the
  core's 7:00 e-mail (`riepilogoMattutino`, the first hook the core offers
  *to* plugins).
- **Six languages**: Italian is the key, English, French, German, Spanish and Portuguese
  are catalogues in `ui/src/i18n.ts`; the language is the one the core saved
  (`kancrm-lang`, same origin, same `localStorage`).
- **On a phone** the page never scrolls sideways: the kanban does (rule 14 of
  the core).

## Data: the plugin's own tables

Six tables, all `plugin_personale_*`, created and migrated by the plugin
(`lib/schema.mjs`), versioned in `plugin_personale_config`:

| table | holds |
|---|---|
| `config` | `plugin_version`, `schema_version` and settings (the SDK creates it first) |
| `owner` | who already received the welcome board — once |
| `board` | boards, with owner and tab position |
| `status` | the columns of each board |
| `task` | the cards |
| `activity` | the cards' history |

Foreign keys point one way only, from the plugin to the core (`User`,
`ON DELETE CASCADE`), never the other way: a disabled plugin must not break a
deletion in the core. Dates are ISO strings on both engines (SQLite in
development, MariaDB in production): the switch script copies rows verbatim.
The DDL is one text for both engines, the only dialect corner being the table
suffix (`db.sql.createTableSuffix()`).

## How it talks to KeelOps

Everything goes through the plugin SDK (`plugins/keelops-sdk`): the database
is the driver the core lends (`ctx.db`, prefix-gated: the plugin can write
`plugin_personale_*` and nothing else), the user is `ctx.sessionUser(req)`
(the core's real session), the look is `BASE_CSS` and the frame-resize script
from `ui.mjs`. The plugin never opens the database, reads the core's `.env`,
or calls a service by itself; a core test (`test/plugins-through-sdk.test.ts`)
reads the plugins' sources and refuses otherwise.

## API

Under `/plugins/Personale/api/`, JSON, session cookie of KeelOps:

```
GET    boards                       my boards, with columns
POST   boards                       { name, template }
PUT    boards/order                 { order: [id…] }
PATCH  boards/:id                   { name }
DELETE boards/:id
PUT    boards/:id/statuses          { statuses: [{ id?, name, color, isInitial, isClosed }…] }
GET    boards/:id/tasks?includeArchived=1
POST   boards/:id/tasks             { title, description?, boardStatusId?, assigneeId?, supervisorId?, dueDate?, dueTime? }
PATCH  boards/:id/tasks/:taskId     the same fields, plus archived
DELETE boards/:id/tasks/:taskId
GET    utenti                       who can be put on a card (internal, active)
GET    dashboard[?gruppo=overdue|today|tomorrow|next|none]
                                    my open cards, for the dashboard tile (or one group only)
GET    gruppi                       { gruppi: { overdue, today, tomorrow, next, none } } — the chips
```

Errors are `{ errore, codice }` with the status that fits: 400 validation,
401 no session, 404 not yours, 409 duplicate name.

## Layout

```
plugin.mjs         manifest + create(ctx): routes, static dist, migrate, riepilogoMattutino
lib/schema.mjs     the tables and the migration steps
lib/boards.mjs     boards, columns, templates, the welcome board
lib/tasks.mjs      cards, dashboard groups, counts, who has cards due (for the digest)
lib/riepilogo.mjs  the morning-digest line, in six languages
lib/routes.mjs     the HTTP surface above
lib/validate.mjs   input checks and HttpError
ui/                the page (React + Vite): App, kanban, dialogs, api, i18n, styles
server.mjs         standalone mode (development), on a COPY of the database
selftest.mjs       the end-to-end check of every rule, by HTTP
```

## Development and checks

```bash
cd ui && pnpm build                       # the page (also done by the root `pnpm build`)
node server.mjs                           # standalone, KEELOPS_DB=<copy of the db> in .env
node selftest.mjs /path/to/a/COPY.db      # never the real one: it writes sessions and boards
```

In the core: `e2e/plugin-personale.spec.ts` (Playwright: menu entry, welcome
board, card with a time, drag between columns, filters, the phone), and
`test/plugin-digest.test.ts` for the digest hook. In production the plugin is
enabled with `PLUGINS=…,Personale` in the `.env` of KeelOps.
