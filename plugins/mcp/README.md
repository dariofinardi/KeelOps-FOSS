# MCP plugin (base version, without PII filter)

A remote [MCP](https://modelcontextprotocol.io) server with OAuth 2.1 that lets
Claude, ChatGPT and Mistral **read** KeelOps. No tool writes.

**The identity is the user's, not the plugin's.** The consent page recognises the
KeelOps session (same domain via nginx), the token is born bound to that user and
every tool answers within that user's perimeter: an assistant connected with my
token sees what I see — other people's quotes and other people's hours stay out
(tested in `selftest.mjs`). External users (portal, monitor) cannot authorise
anything.

This is the **base version, for trusted clients**: texts reach the assistant
as they are. The version with pseudonymisation (`gliner2_pii + mcp`) is a
separate product, planned as a paid one.

## Startup

In production the plugin is **side-loaded** into the core: `PLUGINS=mcp` in the
KeelOps `.env` and it answers on `/plugins/mcp/…`. In development it can run on
its own:

```bash
cp .env.example .env   # and fill it in
node server.mjs
```

Nothing to install: just Node ≥ 22. The database is opened **read-only**.

## Public exposure (required by the providers)

Claude, ChatGPT and Mistral want an **HTTPS address reachable from the internet**.
The plugin is served **directly by the KeelOps virtual host**: in the core's
`.env`, `PLUGINS=mcp` is enough and the plugin answers on
`https://crm.example.com/plugins/mcp/…` — nginx need not be touched. In the
plugin's `.env`: `MCP_PUBLIC_URL=https://crm.example.com/plugins/mcp`.

The core also serves the "path-inserted" form of the metadata
(`/.well-known/oauth-authorization-server/plugins/mcp`), the one OAuth clients
use when the issuer has a path (RFC 8414).

## Connecting the assistants

| assistant                        | where                                                        | what to enter                         |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| **Claude** (claude.ai / Desktop) | Settings → Connectors → _Add custom connector_               | `https://crm.example.com/plugins/mcp` |
| **ChatGPT**                      | Settings → Connectors (requires Developer mode / paid plans) | same URL                              |
| **Mistral Le Chat**              | Intelligence → Connectors → _Add MCP connector_              | same URL                              |

In every case the provider discovers the OAuth metadata by itself, registers
itself (dynamic registration, RFC 7591), opens the consent page — which needs
an active KeelOps session in the browser — and from then on uses the token on
your behalf. For ChatGPT there are also the two tools `search` and `fetch`, in
the shapes its connectors demand.

## Exposed tools

`search` · `fetch` · `cerca_task` · `progetti` · `scadenze` · `storico_stati`
(status changes: of one task, or of the last few days on the tasks where the
user has a role) · `mio_timesheet` (the hours logged BY the user, day by day —
always and only their own) · `ore_per_progetto` · `stato_offerte` (pipeline by
stage, won, lost with the **loss reasons** grouped, win rate) · `offerte` (list
filterable by outcome, stage, company, text, days: stage, value, probability,
company, loss reason) · `dettaglio_offerta` (a single one: contact person,
history of stage changes with who/when/why, value changes, chat, linked tasks,
reading of the attachments) — all read-only, all within the user's perimeter.
Every task list carries `offerta` (stage, outcome, reason) when the record is a
quote.

**For analysis** (31/08/2026), one aggregate block per kind of data, so the
model can compute statistics without downloading records one by one:
`guida_dati` (how the data is shaped and which tool to use) · `statistiche_task`
(totals, delays, by type/status/assignee, monthly trend, average closing time) ·
`dettaglio_progetto` (members, tasks, hours per person and per month, requests) ·
`statistiche_richieste` (tickets by priority, project, requester, resolution
times) · `statistiche_ore` (hours by project/person/month/activity
type/company, days and average) · `aziende` (weight of each customer:
open/won/lost quotes with their values, projects, contacts). `stato_offerte`
also carries the weighted pipeline, the monthly trend of closings and the top
companies. Task lists carry `aperto_il`, `chiuso_il` and `ore`.

## Record tools (05/09/2026)

Everything that can be **read** about a single thing, always within the user's
perimeter: `dettaglio_task` (of any type: fields, three roles, tags, company and
contact person, subtasks and sequence, hours per person, recurrence, request
data, non-private chat with its attachments, attachments with ids, full
history) · `allegati_task` · **`leggi_allegato`** (the extracted text of PDF,
Word and text files and, with `formato: "file"`, the document itself: images as
an image, the rest as a resource, up to 8 MB — the file is lent by the core with
**its own** access rule, `ctx.attachments`; outside the core the tool says so;
for a **link** — Drive or other — KeelOps only has the address and says so: it
is read with the assistant's connector for that service, authorised with an
account that has permission on the file) · `richieste` (tickets with priority,
reference, requester and company, last message) · `messaggi` (the chat of the
tasks where the user has a role, or of one task, with text search) ·
`cerca_contatti` and `dettaglio_azienda` (the address book: contacts, companies,
quotes, projects, CRM notes, portal users) · `persone` (who is who: role,
groups, projects) · `mie_notifiche` · `ricorrenze` · `tag` (and `cerca_task`
filters by tag) · `mie_bacheche` (the cards of the «Personale» extension, if
enabled). Attachments are also MCP **resources**: `keelops://allegato/<id>` via
`resources/read`.

## Security, in brief

- OAuth 2.1: authorization code + mandatory PKCE S256, rotating refresh,
  https-only redirect_uri (or localhost), single-use codes valid for 10 minutes.
- Tokens live 8 hours and are stored as sha256 fingerprints in `data/oauth.json`:
  the file holds nothing that can be spent.
- `/mcp` without a token answers 401 with a `WWW-Authenticate` pointing to the
  metadata (RFC 9728), as the MCP specification requires.
- Revocation: from the instructions page ("Connessioni attive" → Revoca, for
  one's own user), from the provider when you disconnect the connector
  (RFC 7009), or — clean sweep — by deleting `data/oauth.json`.

## Paid version (`gliner2_pii + mcp`): plan

A separate product, not built yet. Requirements gathered so far:

- **PII pseudonymisation** of outgoing texts with GLiNER2 **in ONNX inside
  Node** (no Python sidecar), with a configurable entity vocabulary and a
  reversible map kept server-side only.
- **Reading attached documents** (requested on 24/08/2026, **done in the base
  version on 05/09/2026** with `leggi_allegato`; what remains here is the PII
  filter to put in front of it): before, `fetch` returned only the record's text
  fields — an assistant could not read the estimate attached to a quote. The
  commercial version must expose them:
  - server-side text extraction (PDFs, spreadsheets, documents; no raw bytes
    to the assistant) from the attachment store, within the **user's
    perimeter** and with a size cap; Drive links stay links (the core keeps no
    Drive tokens, by choice);
  - the extracted text goes through the PII filter **first**, when configured;
  - exposure via `fetch` on the record (attachments appended to the text) or a
    dedicated `leggi_allegato` tool, to be decided by measuring what clients
    use best.

## Testing

```bash
node selftest.mjs /path/to/a/COPY/of/the/db   # never the original: it creates fake sessions
```

## The editions (08/10/2026)

On a **community** core there are no timesheets, support requests or quote
analysis. The connector **hides** the tools that depend on them
(`ore_per_progetto`, `statistiche_ore`, `richieste`, `statistiche_richieste`:
they are declared with `richiede` in `lib/edizione.mjs`) instead of answering
empty — "you worked 0 hours" would be false — and when called by name they
answer "not available in this edition". In the mixed tools the fields without
data disappear (`nata_da_ticket`, the request block, `utenti_portale`,
`lettura_allegati`, `TICKET` among the types, the aggregated hours of
`progetti` and `dettaglio_progetto`) and the data guide gets shorter
accordingly. Basic hours exist in both editions (the timesheet grid has been
part of the core since 08/10/2026): `mio_timesheet` and a task's hours always
remain.

The features come from `ctx.funzioni` and travel on the user
(`user.funzioni`): `buildTools(db, user, …)` keeps its signature, and MCP-pro —
which runs only in the commercial edition — sees everything as before. Without
`funzioni` (standalone mode, older core) everything is available.
