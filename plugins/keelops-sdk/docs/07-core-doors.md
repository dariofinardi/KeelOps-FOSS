# Working with the core

A plugin never writes into the core's tables. When it needs a task, an
attachment or a group of people, it goes through a **door** the core lends in
`ctx`. Each door applies the core's own rules — who may do what,
notifications, the activity log — exactly as if a person had done it by hand.

**Every row a plugin creates in a core table carries its mark**:
`pluginNick` (the plugin) and `pluginRef` (the plugin's own reference, when it
gives one). The core sets the nick, binding each door to the plugin that
received it: no plugin can sign with another's name. The mark answers
"what did this plugin leave behind?" — the question an uninstall will ask.

Which doors exist depends on the [edition](02-manifest.md#editions):

| door | community | commercial |
|---|---|---|
| `tasks`, `attachments`, `perimeter`, `groups`, `segnali` | ✓ | ✓ |
| `mail` (with `mail:send`) | ✓ | ✓ |
| `plugins` (with `plugins:strumenti`) | ✓ | ✓ |
| `google` (with `google:oauth`) | `null` | ✓ |
| `timesheet` (with `timesheet:write`; reading only with `timesheet:read`) | `null` | ✓ |
| `ollamaUrl` | ✓ if configured | ✓ if configured |

## Tasks

```js
const task = await ctx.tasks.create(user.id, {
  title: "Corrective action: seal the bottle cap",
  description: "<p>From NC-2026-004.</p>",   // rich text (HTML) or plain
  projectId,                                    // optional
  assigneeId, supervisorId,                     // optional: default is the creator
  dueDate: "2026-10-15",                        // optional, YYYY-MM-DD
  statusId, activityTypeId,                     // optional
  relatedDealId,                                // optional: a deadline linked to a deal
  ref: nc.id,                                   // the plugin's record, for the mark
});
```

The task is created **as that person**: their permission to create it, the
initial status of its category, the default referent, the notification to
the assignee, the line in the history. It returns the task as that person
sees it. It throws with a readable message when the person may not create it,
when the title is empty, and in the public demo (which writes nothing).

```js
const t = await ctx.tasks.read(user.id, taskId);           // → Task | null
const many = await ctx.tasks.readMany(user.id, [id1, id2]); // → Map<id, Task>
```

Reading applies **the core's visibility rule**, with all its nuances: what
that person may not see comes back as `null` (or is missing from the map) —
not as an error. The shape:

```js
{
  id, title, kind,           // kind: "ADMIN" | "DEAL" | "PROJECT" | "TICKET" | "PERSONAL"
  status, statusClosed,      // the status name, and whether it is a closing one
  assigneeId, assignee,      // id and name
  dueDate, projectId,
  canEdit,                   // whether that person may also edit it
  pluginNick, pluginRef,     // the mark, when a plugin created it
}
```

With `"permessi": ["tasks:write"]` a plugin can also **change** a task, with
the service of the task panel (statuses, sequences, notifications, history):

```js
await ctx.tasks.update(user.id, taskId, { dueDate: "2026-11-05", statusId });
```

The input is the core's `updateTaskSchema` (only the fields passed). A deal is
refused: it has its own fields and rules, see [deals](#deals-and-contacts).

### The channel in the history

Everything a plugin writes on behalf of a person goes into the history **with
the plugin's channel**: "Maria Rossi via MCP". The channel is the
manifest's `canale`, or its `titolo`. The person stays the one who asked; the
channel says where the change came from.

## Deals and contacts

With `"permessi": ["deals:write"]`, `ctx.offerte` creates and changes deals;
with `"contacts:write"`, `ctx.crm` finds or creates companies and creates and
changes contacts. Both run the **functions of the app's pages**, as the
person (with the admin elevation applied, as everywhere): their permissions,
the stages and their closing rules, the statuses, the notifications, the
field-by-field history with the channel. The input is validated by the core
with the shared schemas; an id that does not exist is a refusal with its
sentence. In the public demo nothing is written.

```js
const deal = await ctx.offerte.crea(user.id, {        // createDealSchema
  title, description, stageId, companyId, contactId, assigneeId,
  dealValue, probability, expectedCloseDate, visibleToSalesMonitors,
});                                                    // → the deal's detail
await ctx.offerte.aggiorna(user.id, deal.id, {         // updateDealSchema: only what changes
  contactId, stageId, lostReason, visibleToSalesMonitors,
});

const company = await ctx.crm.azienda(user.id, { name: "Acme srl", city }); // → { id, name, created }
await ctx.crm.aggiornaAzienda(user.id, company.id, { vatNumber });
const contact = await ctx.crm.creaContatto(user.id, { firstName, lastName, email, companyId });
await ctx.crm.aggiornaContatto(user.id, contact.id, { roleTitle: "CTO" });
```

`azienda` **finds or creates**: a company with the same name, written
differently ("Acme srl" for "Acme"), comes back with `created: false`. The
reference tables (stages, statuses, activity types, people) are read with
`ctx.db`. Companies and contacts have no history in the core: a plugin that
needs one keeps it in its own tables.

## Attachments

```js
const a = await ctx.attachments.read(user.id, attachmentId, { bytes: true });
```

Reading applies the core's rule (who sees the task reads its files) and
returns `{ id, name, type, mimeType, size, url, text, saltato, bytes }`:

- `type` is `FILE` or `LINK`; a link has `url` (a Google Drive document, say);
- `text` is the text the core already extracted (PDF, Word, plain text);
- `bytes` is a `Buffer`, only when asked and under **8 MB**; otherwise
  `saltato` ("skipped") says why.

```js
const written = await ctx.attachments.write(user.id, taskId, {
  name: "quote-2026-041.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes: buffer,
  replaceAttachmentId: previousId,   // optional: replace, keeping the same id
  ref: documentId,                   // optional: the mark
});
// → { id, name, size, sostituito }   (sostituito = replaced)
```

Writing follows the core's rule: **who can edit the task can attach**. The
upload lands in the task's history like any other.

## Permissions

```js
const may = await ctx.perimeter.canEditTask(user.id, taskId);   // → boolean
```

The core's own edit check, dry: a `false` is an answer, not a failure. Use it
before offering a command; the door that writes will check again anyway.

## Timesheet

On a core with the `timesheet` function (commercial; elsewhere
`ctx.timesheet` is `null`). With `"permessi": ["timesheet:write"]` the whole
door; with `"timesheet:read"` only the two reading functions, `quadro` and
`meseChiuso` — a plugin that asked to read never holds a function that writes.

### Writing (`timesheet:write`)

```js
const cell = await ctx.timesheet.aggiungi(user.id, {
  taskId,
  date: "2026-09-29",        // YYYY-MM-DD
  ore: 2.5,                  // hours to ADD; negative to take some back
  nota: "RAP-2026-0041",     // the cell's note, only if it has none yet
});
// → { taskId, date, ore }   (ore = the cell's total now)
const closed = await ctx.timesheet.meseChiuso("2026-08");   // → boolean
```

The door **adds**: hours from a plugin join the ones the person typed by hand
on the same task and day. A plugin that corrects its record sends the
difference, and keeps in its own tables how much it added — the cell does not
carry the plugin's mark, because it holds hours of mixed origin and belongs
to whoever did the work. The grid's rules apply: a closed month, a task the
person cannot see, a task in the bin or on a board, more than 24 hours in a
day — each throws with a readable message. The public demo writes nothing.

### Reading the month (`timesheet:read`)

```js
const q = await ctx.timesheet.quadro(user.id, "2026-09", [userId1, userId2]);
// → { month, hours, expected, calendar, weeks: [...],
//     people: [{ userId, name, isActive, weeklyHours, hours, expected,
//                coverage, weeks: [{ week, hours, expected, untracked, coverage }],
//                projects: [{ name, hours, share, weeks }] }],
//     projects: [{ name, hours, share }] }
```

The month as the timesheet analytics page and its spreadsheet show it —
the same function, so a report built by a plugin matches the one downloaded
by hand: recorded hours against the hours due by contract, absences included,
and where the time went. It is read **with that person's eyes**: the hours
they may see, the people they may look at; the optional list of people picks
among those, it never widens them. Hours are rounded to a tenth and shares to
whole percents, as on the page. For exact sums over any span of days, query
`TimeEntry` with `timeEntryPerimeter(user)` ([data](04-data.md)).

## Mail

With `"permessi": ["mail:send"]`:

```js
if (ctx.mail.attiva()) {
  const { inviata, motivo } = await ctx.mail.invia(user.id, {
    to: "customer@example.com",
    toName: "Mario Rossi",          // for the greeting
    locale: "it",                    // the frame's language
    subject: "Work report RAP-2026-0041",
    text: "Attached is the report.\n\nKind regards",   // plain text; blank line = paragraph
    attachments: [{ filename: "RAP-2026-0041.pdf", contentType: "application/pdf", content: pdf }],
  });
}
```

The message leaves with the core's channel, sender and brand — the same frame
as KeelOps' own email — and **replies go to the person who sent it**. The body
is **text**: the door escapes it and lays it out in paragraphs, so no plugin
builds HTML for an outside address. One recipient per message, attachments up
to 10 MB in total. A mail server that refuses the message is an outcome
(`{ inviata: false, motivo }`), not an exception; a malformed address throws.

## Groups

A plugin that governs a trade — quality, attendance — needs to know **who
does that job**. It asks the core for a group of its own:

```js
const group = await ctx.groups.ensure({ chiave: "quality", nome: "Quality", area: "QUALITY" });
// → { id, nome, area, chiave, origine }   origine: "creato" | "esistente" | "adottato"
const again   = await ctx.groups.read("quality");      // → the group, or null if deleted
const members = await ctx.groups.members("quality");   // → [{ id, name, isManager }]
```

- The identity is the pair (plugin, **`chiave`** — key), **never the name**:
  an administrator renames the group whenever they like, and the plugin still
  finds it.
- `ensure` creates the group **once**. If a group with that name exists and
  no plugin claims it, it is **adopted** (`origine: "adottato"`), members and
  all.
- If an administrator deletes it, the plugin **does not bring it back**: it
  notices from `read()` returning `null`, and says so on its page. People are
  put in the group from the core's Groups page, by an administrator.
- `ui.soloGruppo: true` in the manifest hides the menu entry from people
  outside the group.

`create()` runs before the plugin's tables exist, so call `ensure` at the
first request, and remember the group's id in the config table.

## Tools shared between plugins

A plugin can **offer tools** to other plugins, and a plugin that asks for the
`plugins:strumenti` permission can **use** them. This is how the MCP
connector lets Claude, ChatGPT and Mistral read QABox's quality data: QABox
declares what it offers, the connector finds it, and neither knows how the
other is built.

Offering — `create()` returns `strumenti` (tools):

```js
return {
  routes,
  strumenti: [
    {
      nome: "dashboard",                        // name: lowercase, digits, _ (max 49)
      descrizione: "The quality dashboard for the person: batches to inspect, open non-conformities…",
      parametri: { type: "object", properties: {} },   // JSON Schema of the parameters
      esegui: async (utente, parametri) => {    // run(user, params)
        await assertInQualityGroup(utente);     // YOUR access rules stay here
        return readDashboard(utente);
      },
    },
  ],
};
```

Using — with `"permessi": ["plugins:strumenti"]` in the manifest:

```js
for (const tool of ctx.plugins.strumenti()) {
  tool.plugin;        // "QABox"
  tool.nome;          // "qabox_dashboard" — prefixed with the offering plugin's nick
  tool.descrizione;
  tool.parametri;
  const answer = await tool.esegui(user.id, {});   // run it for this person
}
```

Three rules, and they are why the tools go through the core:

- **Declared, never scanned.** Another plugin sees only what you offer. Your
  routes, tables and access checks stay yours: put the checks inside
  `esegui`.
- **The core supplies the identity.** The caller passes a person's id; your
  `esegui` receives the user read from the database — active and internal —
  in the same shape as `ctx.sessionUser`. Nobody can call your tools as a
  made-up user.
- **A plugin that is off disappears from here too**, at once. The list is
  read at call time, so the order of `PLUGINS` does not matter.

Keep tools **read-only** unless there is a very good reason: a tool is called
by software, often by a language model, and a write deserves a person
pressing a button.

## Signals

```js
ctx.segnali.invia(user.id, { motivo: "activity" });   // segnali.invia = signals.send
```

Sends an event on the core's live channel to that person's open browser
tabs, tagged with the plugin's name. Today it makes the plugin's **bar
button** reload its state at once (see [the bar button](05-pages.md#the-bar-button)).
There is no queue: someone who is not connected does not receive it — it is a
nudge, not a message. Throttle it: one signal every few seconds per person is
plenty.

## The morning digest

At 7:00 KeelOps sends each person a digest of what is due. A plugin can add
lines to it:

```js
return {
  routes,
  riepilogoMattutino: async ({ oggi }) => {          // oggi = today, YYYY-MM-DD
    const late = await countLateBoardsPerUser(oggi);
    return late.map(({ userId, n }) => ({
      userId,
      righe: (locale) => [locale === "it" ? `Bacheche personali: ${n} in ritardo` : `Personal boards: ${n} overdue`],
    }));
  },
};
```

- One entry per person who has something to hear; `righe(locale)` returns the
  lines **in the recipient's language** (the core knows it, the plugin does
  not).
- A line alone is enough to send a digest that day.
- A plugin that fails or takes more than ten seconds does not stop the
  digest: its part is missing and the log says why.

## OAuth with Google

With `"permessi": ["google:oauth"]`, `ctx.google` carries the installation's
Google OAuth client (`enabled`, `clientId`, `clientSecret`), so a plugin can
ask a person to connect their own account (the MCP connector pro reads Google
Drive this way). The secret never reaches the browser; the refresh tokens the
plugin receives are its responsibility — encrypt them in its own tables.

Google services are part of the commercial edition (the `google` function in
`ctx.funzioni`): in the community `ctx.google` is `null` even with the
permission, and a plugin that needs it declares `"richiede": ["google"]`.
