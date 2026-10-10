# KeelOps Community

**Deadlines, deals, projects and hours for a small team, in one place, on your own
server.** KeelOps is a web application for companies of five to fifty people that
want few tools that work well together instead of a different service for each
job. It is written in TypeScript, runs on Node.js, and keeps its data in SQLite or
MariaDB.

This is the **community edition**, free software under the GNU AGPL v3. A
commercial edition with more modules exists (see
[What the community edition does not include](#what-the-community-edition-does-not-include)).
Try both before installing: [community.keelops.it](https://community.keelops.it)
runs this edition, [demo.keelops.it](https://demo.keelops.it) the commercial one,
on the same sample data. What KeelOps is, the two editions side by side, the
plugins and the SDK documentation are on **[keelops.it](https://keelops.it)**.
KeelOps is made by **[Jugaad](https://jugaad.digital)**.

It is released in two forms: **the source code**, here, and **a Docker image**,
`ghcr.io/dariofinardi/keelops-community`, with a `docker-compose.yml` that puts
HTTPS in front of it (see [Installing](#installing)).

## What it does

### Deadlines (the administrative calendar)

- Tasks with a due date, an assignee and a supervisor, organised by **area**
  (administration, sales, development), each with its own statuses and activity
  types.
- **Recurrences** (monthly VAT, yearly renewals…) with exceptions, end dates and
  "stops renewing" statuses; the occurrences are created ahead of time.
- **Sequences**: tasks that come one after the other, with a warning when one is
  completed out of order.
- **Subtasks, tags, meetings** (a task type whose comments become the minutes),
  mentions, a chat on every task, **encrypted messages** readable only by the
  people they are meant for.
- **WIP limits** per status within a project, a recycle bin, merging and
  duplicating tasks, a full history of every change.

### Deals and contacts

- A **pipeline** with your own stages, the weighted value and a monthly forecast,
  the next step of every deal, the reason a deal was lost.
- **Companies and contacts**, with dated notes and the deals that belong to them.
- **A won deal creates the billing task** for the administration, and a deal can
  be created from a project task.

### Projects

- Projects with **members and roles** (manager, editor, viewer) and their own
  board; a customer, a colour, an archive.
- Task boards as **kanban, table and agenda**, with filters that remember
  themselves and counters that only show what exists.

### Timesheet

- The **month and week grid**: hours on any task you can see, picked from a search
  box; the grid of a colleague for managers.
- **Summaries** of the month and of the week by project and by person, for
  managers; **closing a month** so nobody changes it afterwards.

### Every day

- **My day**: what is due, overdue and assigned to you, at a glance.
- **The dev area overview** for the development manager: flow, queue, WIP limits,
  hours per project, overdue tasks per person.
- **Global search** across tasks, deals, projects, recurrences, messages and
  attachments, within what each person may see.
- **Notifications** in the app (real time), by **email** (when an SMTP server is
  configured), as **web push** on desktop and phone, with a daily digest of what
  is due; **iCal feeds** of any board for Google Calendar, Outlook or a phone.

### Files

- Attachments on every task, deal and recurrence: files, kept on the server's disk
  or in a Google Cloud Storage bucket, and links.
- A **built-in viewer** for PDF, Word, images and Markdown; images pasted into a
  description travel with the record.

### People and security

- Users, **groups** and **visibility per area** (none, read only, full), group
  managers, project perimeters.
- **Time-limited admin elevation** (an administrator works as a normal user until
  they ask for more), sign-in with password or with a **one-time code by email**,
  password reset, lockout after repeated failures, a password pepper kept outside
  the database.
- **Six languages**: Italian, English, French, German, Spanish, Portuguese.

### Data in and out

- **Import from Excel** with downloadable templates (tasks and recurrences, deals,
  contacts, companies), from **iCal** files and from **CSV contacts** (the Google Contacts
  export format). **CSV export** of tasks and deals.
- Backups of the database and of the files, maintenance mode, storage usage.

### Plugins

- A **plugin SDK** (`plugins/keelops-sdk`): plugins run inside the core process,
  read through a connection that cannot write, own their tables, and get doors to
  tasks, attachments, groups, mail and the local model.
- A **job queue for local AI** through [Ollama](https://ollama.com), for the
  plugins that use a model.
- Three free plugins:
  - **Personale** — personal kanban boards, visible to nobody else;
  - **TasksMap** — the network of a project's tasks, computed from the data (a
    demo of what a plugin can do);
  - **mcp** — an MCP connector that lets Claude, ChatGPT and Mistral **read**
    tasks, deals, projects, contacts and your own hours, with your permissions.

## Dependencies

**To run it**

|               |                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Node.js       | 20 or newer (tested on 22)                                                                                              |
| pnpm          | 10 (`corepack enable`)                                                                                                  |
| Database      | SQLite (built in, fine for trying it and for small teams) or **MariaDB** (recommended in production; tested on 10.6)    |
| Optional      | an SMTP server for email, Ollama for the plugins that use a local model, a Google Cloud Storage bucket for the files    |
| In production | a reverse proxy with TLS (nginx, Caddy…): sessions use `Secure` cookies; with Docker, the Caddy of `docker-compose.yml` |

**Main libraries**: Fastify, Prisma (with the SQLite and MariaDB driver adapters),
zod, rrule, node-cron, argon2, nodemailer, web-push, sharp, ExcelJS, SheetJS (a
vendored copy of 0.20.3, see `vendor/`), unpdf on the server; React 18, Vite,
Tailwind, TanStack Query, dnd-kit, Tiptap, pdf.js, i18next in the browser.

**Their licences** (production dependencies, 446 packages): MIT, Apache-2.0, ISC
and BSD for almost all of them. The exceptions are compatible with the AGPL and
used unmodified: the MariaDB connector (LGPL-2.1), libvips inside sharp
(LGPL-3.0), web-push (MPL-2.0). `pnpm licenses list --prod` gives the full list.

## Installing

### With Docker

**What you need**: Docker with the Compose plugin (`docker compose version`), a
machine with 2 GB of RAM, and — for a real installation — a domain name pointing
at it with ports 80 and 443 reachable. Nothing to build: the image comes from the
registry.

**What runs**: two containers, three with MariaDB. KeelOps publishes its own
image; the other two are the official ones of their projects.

| Container | Image                                    | Role                                                                                    |
| --------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `keelops` | `ghcr.io/dariofinardi/keelops-community` | the server and the web app, on port 3001 inside the network                             |
| `caddy`   | `caddy:2`                                | HTTPS in front: a local certificate on `localhost`, Let's Encrypt on a real domain      |
| `mariadb` | `mariadb:11`                             | the database, only with `docker-compose.mariadb.yml`; otherwise SQLite inside `keelops` |

**1. Get the compose files.** Clone the repository, or download just
`docker-compose.yml`, `docker-compose.mariadb.yml` and `docker/Caddyfile`
into a folder of their own.

```bash
git clone https://github.com/dariofinardi/KeelOps-FOSS.git keelops && cd keelops
```

**2. Start it.** With SQLite (fine to try it, and for a small team):

```bash
KEELOPS_ADMIN_EMAIL=you@example.com docker compose up -d
```

With MariaDB (recommended for production): first write a `.env` file next to
`docker-compose.yml` with the two database passwords, which Compose reads and
you will need again for backups —

| Variable                | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `MARIA_DB_PASS`         | the password of the `keelops` database user, long and random |
| `MARIADB_ROOT_PASSWORD` | the password of the MariaDB root, long and random            |
| `KEELOPS_ADMIN_EMAIL`   | your address, the first administrator                        |

— then:

```bash
docker compose -f docker-compose.yml -f docker-compose.mariadb.yml up -d
```

The first start creates the password pepper and the key of confidential messages,
creates the tables, seeds statuses, deal stages and activity types, and creates
the first administrator. Then:

```bash
docker compose logs keelops | grep "Password provvisoria"   # the temporary password
```

**3. Sign in** at `https://localhost` (the browser warns once about the local
certificate) with `KEELOPS_ADMIN_EMAIL` and the temporary password; KeelOps asks
you to choose your own. On a server, set the domain before the first start and
Caddy obtains the certificate by itself:

```bash
KEELOPS_DOMAIN=keelops.example.com KEELOPS_ADMIN_EMAIL=you@example.com docker compose up -d
```

The same `.env` file can hold `KEELOPS_DOMAIN` and `KEELOPS_ADMIN_EMAIL`, so
that `docker compose up -d` needs nothing else.

**Configuring KeelOps** (mail, Ollama, limits…): every variable of
`.env.example` goes under `environment` of the `keelops` service. Keep your
changes in a `docker-compose.override.yml`, which Compose merges automatically,
so that updates of the repository do not touch them:

```yaml
services:
  keelops:
    environment:
      MAILER_HOST: smtp.example.com
      MAILER_PORT: "587"
      MAILER_USERNAME: keelops
      MAILER_PASSWORD: "…"
      MAILER_FROM: "KeelOps <no-reply@example.com>"
      OLLAMA_URL: http://host.docker.internal:11434
    # Ollama on the host machine: on Linux this line makes the name resolve.
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**Where the data are, and backups.** Three named volumes:

| Volume            | Content                                                  | Back it up?                                                                      |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `keelops-data`    | SQLite database (`app.db`), attachments, nightly backups | yes                                                                              |
| `keelops-config`  | the password pepper and the key of confidential messages | **yes — without it nobody can sign in and confidential messages cannot be read** |
| `keelops-mariadb` | the MariaDB database, with `docker-compose.mariadb.yml`  | yes                                                                              |

A copy of a volume, as a `.tgz` in the current folder:

```bash
docker run --rm -v keelops_keelops-config:/v -v "$PWD":/b busybox tar czf /b/keelops-config.tgz -C /v .
```

(`keelops_` is the Compose project name, the folder's name by default: `docker volume ls` shows the exact names.) With MariaDB, prefer a dump:
`docker compose exec mariadb mariadb-dump -ukeelops -p keelops > keelops.sql`
(it asks for the password).

**Updating**:

```bash
docker compose pull && docker compose up -d
```

The tables are brought up to date at every start. `latest` follows the main
branch; `ghcr.io/dariofinardi/keelops-community:X.Y.Z` pins a release (the
version is in the Help page of the app), `sha-…` a commit.

**Useful commands**: `docker compose logs -f keelops` (the server's log),
`docker compose ps` (state and health), `docker compose down` (stop; the
volumes stay), `docker compose down -v` (stop and **delete everything**).

**Behind your own reverse proxy** (nginx, Traefik…): remove the `caddy` service,
publish the application port on the loopback only
(`ports: ["127.0.0.1:3001:3001"]` under `keelops`), set `TRUST_PROXY: loopback`
and terminate TLS in your proxy; `APP_BASE_URL` must be the public address.
Sessions use `Secure` cookies: plain HTTP does not sign you in.

### From source, to try it

```bash
pnpm install
pnpm --filter @kancrm/server exec prisma generate
pnpm db:migrate        # creates data/app.db
pnpm db:seed           # sample structure and users (admin@kancrm.local / admin1234)
pnpm dev               # API on :3001, web app on http://localhost:5173
```

### From source, in production

```bash
cp .env.example .env            # and fill it in: NODE_ENV, APP_BASE_URL, database, mail
pnpm install --frozen-lockfile
pnpm --filter @kancrm/server exec prisma generate
pnpm build                      # the web app is served by the server itself

# MariaDB: the schema, its client and the tables
cd apps/server
pnpm exec tsx scripts/mariadb/genera-schema.ts
DATABASE_URL_MARIADB="mysql://x:y@127.0.0.1:3306/z" \
  pnpm exec prisma generate --schema=prisma/mariadb/schema.prisma
pnpm exec tsx --env-file=../../.env scripts/mariadb/prepara-db.ts

# The structure (statuses, stages, activity types) and the first administrator
SEED_MINIMAL=1 pnpm exec tsx --env-file=../../.env prisma/seed.ts
pnpm exec tsx --env-file=../../.env scripts/utenti.ts crea-admin you@example.com --nome "Your Name"

# Start (under systemd or a process manager)
node --env-file=../../.env --import tsx src/index.ts
```

Keep `data/`, the `.env` and the password pepper file outside the folder you
update: `.env.example` explains every variable.

## Licence

KeelOps Community is © 2026 [Jugaad s.r.l.](https://jugaad.digital), released under the **GNU Affero General
Public License, version 3** ([LICENSE](LICENSE)). You may use, study, change and
share it; if you let people use a modified version over a network, you must offer
them its source code.

Contributions are welcome under a Contributor License Agreement
([CLA.md](CLA.md), [CONTRIBUTING.md](CONTRIBUTING.md)): you keep the copyright on
your work, your contribution stays available under the AGPL, and Jugaad may also
use it in the commercial edition.

Every source file carries the licence in its first lines
(`SPDX-License-Identifier: AGPL-3.0-only`).

"KeelOps" and its logo are trademarks of Jugaad s.r.l.

## What the community edition does not include

These are part of the **commercial edition** (licence for on-premise installation,
or hosted by us):

| Area                 | Commercial only                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Support requests** | Tickets, the customer portal, the internal help desk, priorities, ticket → project task                                                                                               |
| **Integrations**     | The API for external systems (osTicket and others), the form you embed in your own application, API keys                                                                              |
| **Google**           | Sign-in with Google, the Google Drive picker, the Drive preview and reading Drive documents. In the community a Drive link is a link like any other                                   |
| **Full timesheet**   | Rows from your activity, removal of empty rows, suggested hours, reminders, productivity, the report for a customer (.docx), CSV export, absences from the calendar                   |
| **AI features**      | The task index and the duration estimates, similar work, the summaries, the reading of a won deal's documents, release notes and newsletters written from closed work, Word templates |
| **Sales monitor**    | The area for people outside the company who follow the deals                                                                                                                          |
| **Migrations**       | The Monday and ClickUp dialects of the import                                                                                                                                         |
| **Plugins**          | MCP connector pro (statistics, ticket data), Presenze (attendance), Rapportini (field work reports), QuoteDOCX (quotes in Word), QABox                                                |

The database is the same in both editions: you can move from one to the other
without migrating data. One thing to know when moving from commercial to
community: people who signed in with Google have no password, so an
administrator sets one for them (Users page, or
`scripts/utenti.ts reset <email>`). Moving data from ClickUp, Monday or Jira, and plugins made
for your company, are available as a professional service: see
[keelops.it](https://keelops.it) or write to [Jugaad](https://jugaad.digital).

## Security

Please do not open a public issue for a vulnerability: see [SECURITY.md](SECURITY.md).
