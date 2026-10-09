# CLAUDE.md — KeelOps

The rules of this code base, for people and for coding assistants. Comments in the
code point here ("see CLAUDE.md"). References to `plan/…` in the comments are
Jugaad's internal design notes, not published: the comment next to them carries
the reasoning that matters.

**The product is KeelOps.** `kancrm` survives in package names (`@kancrm/*`), in
`localStorage` keys and in a few paths: renaming the keys would wipe everybody's
saved preferences.

## What it is

A web application, installed on your own server, for a small company: deadlines,
deals and contacts, projects, hours. The goal is **few functions, done well**. Every
installation is used by real people on real data: a change lands on records
somebody is working on.

## Stack (decided: don't change it without a discussion)

TypeScript everywhere (Node ≥ 20) · **Fastify** · **Prisma with driver adapters** —
SQLite in WAL mode or MariaDB, chosen by `DB_ENGINE`; the few dialect differences
live in `apps/server/src/lib/dialetto.ts` · `rrule` for recurrences · `node-cron`
in process · **React 18 + Vite** · Tailwind + shadcn/ui + lucide · TanStack Query ·
dnd-kit · **SSE** for real time (no websockets until needed) · zod in
`packages/shared` · httpOnly cookie sessions, argon2.

```
/apps/server      Fastify + Prisma + cron  → src/modules/<domain>/, src/plugins/, prisma/
/apps/web         React + Vite             → src/features/<mirrors the modules>/, components/ui/, lib/
/packages/shared  zod schemas, enums, pure shared rules
/plugins          the plugin SDK and the free plugins
/data             runtime: app.db, uploads/ (git-ignored)
```

**Editions.** The core runs alone (this repository). The commercial edition adds
modules through `apps/server/src/edition/registry.ts` (server) and the slots of
`apps/web/src/edition/` (web); here `commercial/` holds empty stubs. The core never
imports a commercial module by name: it asks the registry, and renders a slot if
there is one.

## Commands

```bash
pnpm install
pnpm dev            # server :3001 + web :5173
pnpm check          # lint + typecheck + tests of every package: green before every commit
pnpm db:migrate     # prisma migrate dev
pnpm db:seed
pnpm test           # vitest
```

## Code conventions

- `strict: true`, no unjustified `any`.
- Every endpoint: a zod schema **shared** in `packages/shared`, validation on the
  way in, a typed response.
- Dates are **UTC** in the database and shown in the company time zone (one, in
  config). A date-only value is midnight UTC.
- **UI language: Italian is the key** of every translation. Identifiers in English;
  the explanatory comments of this code base are mostly Italian, newer ones English.
- Prisma migrations are always committed; never `db push` outside local
  prototyping. With two engines a migration is **two**: after `prisma migrate dev`,
  regenerate the MariaDB schema (`scripts/mariadb/genera-schema.ts`) and its
  migration (`scripts/mariadb/genera-migrazione.ts --nome …`), and commit both.
- Tests are mandatory for recurrences (rrule edge cases) and for the won deal →
  billing task automation.
- No heavy dependency without a reason written in the commit.

### Don't duplicate

Before writing something, **look for it**. Rules written twice drift apart at the
first change. When a piece of logic is needed in two places, **extract a pure
module with its tests**. Reuse, don't rewrite: `components/ui` (`Combobox`,
`CompanyCombobox`, `ColorPill`, `FilterSelect`, `SidePanel`, `MessageInput`),
`packages/shared` (`hours`, `due-range`, `deal-weight`, `rich-text`,
`closed-tasks`), `lib/useListPrefs`, `lib/useAutosaveText`, `lib/api`
(`apiUpload`), `modules/tasks/company.ts`, `modules/visibility/task-perimeter.ts`.

## UI rules (everywhere)

1. **Field importance** with `<Label importance="required|recommended">`; never
   coloured borders or ad-hoc asterisks.
2. **One pill** (`color-pill.tsx`) for statuses, stages and types; never wrapping.
3. **Icons**: `AREAS` says where a link goes, `FILTER_ICONS` what a filter cuts,
   `MODULE_META` what kind of task it is, `SectionIcon` what a section is about.
4. **Side panels**: one shell, `SidePanel` — same width everywhere, focus trap,
   Esc and click outside included.
5. **Detail panels in this order**: provenance → context → links → assignee and
   supervisor → type → status and due date → tags, description, subtasks,
   sequence, attachments, chat, history.
6. **The context menu and the detail panel offer the same actions.**
7. **Every filter and selection is remembered** in `localStorage` through
   `useListPrefs` — never a bare `useState` for a filter.
8. **Text fields save themselves** with `useAutosaveText`: no hand-written `onBlur`.
9. **Esc closes the last layer** opened (`useEscapeToClose`, a shared stack).
10. **Focus is ready on the first field** when a panel opens, dropdowns excluded
    (`data-no-autofocus`); elsewhere with `data-autofocus`.
11. **A counter at zero is not shown**, nor one zeroed by permissions.
12. **Dropdowns offer only what exists** (facets from the server, with their
    count), and every facet is counted **without its own filter**.
13. **Filters always in the same order**: perimeter → person → refinements →
    sorting → toggles.
14. **The phone is a size, not a reduced version**: 40px targets, 16px fields,
    **never horizontal page scrolling** (`e2e/mobile.spec.ts`).
15. **Every new task is born assigned to and supervised by its creator**;
    completing a task always asks for confirmation.

### i18n

Italian is the key. `apps/web/src/locales/*.json` for the interface,
`apps/server/src/i18n/catalogs/*.json` for what the server sends.

- `en.json` is kept **complete**; fr/de/es may lag behind and fall back to Italian.
- A string with `{{count}}` is a **plural**: it needs `_one`/`_other` in **every**
  catalogue, Italian included. If you don't want a plural, name the variable
  differently (`{{n}}`).
- **Append** new keys at the end: reordering a catalogue makes a huge diff.

## Release notes

Every release adds an entry at the top of
`apps/web/src/features/help/release-notes.ts`, **in English and not translated**:
two or three lines from the point of view of the person using the app — what they
can do today, or what no longer breaks. No file or module names: those belong in
commits.

## Plugins

Plugins (`plugins/`, the contract is `plugins/LEGGIMI.md`, the SDK documentation
`plugins/keelops-sdk/docs/`) run **inside** the core process and are written in
English. Everything goes **through the SDK**: never `node:sqlite`, Prisma or a
database client in a plugin, never the core's `.env`. Reads go through a connection
that cannot write; writes only into the plugin's own tables (`plugin_<nick>_…`).
SQL dialect differences only behind `db.sql.*`; test a query on the other engine
before calling it portable.

## Traps already paid for

- **Prisma, sibling `OR` keys**: two `OR`s in the same object overwrite each other.
  If a `where` has more than one, put them inside `AND: [...]`.
- The **soft-delete** extension adds `deletedAt: null` **on reads**: to see the bin
  use `prismaRaw`.
- `Task.statusId` is `ON DELETE SET NULL`: deleting a status leaves tasks without
  one, invisible to every board.
- **`cn` is tailwind-merge**: adding `flex` to `hidden … xl:flex` removes the
  `hidden` (the last display wins).
- **Ollama serves one request at a time**: parallelism shortens nothing. Reasoning
  models emit `<think>…</think>`, and without the `format` schema the token budget
  is spent there — the answer never arrives, silently.
- **Vite**: the specifiers of `import()` enter the graph of the module that writes
  them. Dynamic imports inside a component are paid by everyone who imports it.
- **Tests waiting for a dynamic import** need an explicit, generous timeout.
- **`localeFromRequest`** prefers the `X-Locale` header to the user's preference:
  send it in tests.
- **Rich text** is HTML in a field that used to be plain text: tell them apart with
  `looksLikeRichText`, not by looking for `<`.

## Things not to do

- No **incoming** mail (reading mailboxes, tasks from emails). Outgoing mail always
  goes through `modules/mail`.
- No generic automation engine: the only automation is won deal → billing task,
  written by hand.
- No multi-tenancy: one installation per company.
- Don't optimise for one database engine: the core speaks Prisma, not SQL.
