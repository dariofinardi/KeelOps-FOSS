# Getting started

This guide builds a small plugin, **Hello**, from an empty folder to a page
in the KeelOps menu. Along the way it touches everything a real plugin uses:
the manifest, `create(ctx)`, a route, the real user, a read from the KeelOps
database, and a page that looks like the application.

You need a development copy of KeelOps (never a production server) and
Node.js 22 or later.

## 1. The folder

Plugins live in the `plugins/` folder of the KeelOps installation, next to
the SDK:

```
plugins/
├── keelops-sdk/
└── Hello/
    ├── manifest.json
    ├── plugin.mjs
    └── ui/
        └── index.html
```

A plugin developed in its own repository is linked in with a symlink
(`ln -s /path/to/Hello plugins/Hello`). Node resolves a symlink to its real
path, so `../keelops-sdk` does not exist from there: that is why the example
below loads the SDK from `ctx.sdkDir`, the path the core passes in. It works
in both cases.

## 2. The manifest

`manifest.json` says who the plugin is and where it shows up:

```json
{
  "nome": "Hello",
  "titolo": "Hello",
  "versione": "0.1.0",
  "descrizione": "A first plugin: how many open tasks you have.",
  "sommario": { "it": "Un primo plugin.", "en": "A first plugin." },
  "copyright": "© 2026 Your Company",
  "licenza": "libero",
  "ui": { "voce": "Hello", "icona": "puzzle", "menu": true },
  "health": "/health"
}
```

- `nome` is the name the core mounts it under: `/plugins/Hello/`.
- `ui.voce` is the label of the menu entry, `ui.icona` a name from the
  application's icon set (or a file of yours, see [pages](05-pages.md)).
- `health` is a path the core — and your monitoring — can call without a
  session.

Every field is described in [the manifest](02-manifest.md).

## 3. plugin.mjs

The core imports `plugin.mjs`, reads its `manifest` export and calls
`create(ctx)`:

```js
// plugins/Hello/plugin.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));

export async function create(ctx) {
  // The SDK is loaded from where the core says it is: a plugin linked in
  // from another folder cannot see ../keelops-sdk.
  const sdk = (file) => import(pathToFileURL(join(ctx.sdkDir, file)).href);
  const [{ json }, { BASE_CSS }, { taskPerimeter }] = await Promise.all([
    sdk("http.mjs"), sdk("ui.mjs"), sdk("perimeter.mjs"),
  ]);

  return {
    staticDir: join(HERE, "ui"),
    routes: [
      ["GET", /^\/health$/, (req, res) => json(res, 200, { ok: true, version: manifest.versione })],

      // The application's look: colours, fonts, dark mode.
      ["GET", /^\/base\.css$/, (req, res) => {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(BASE_CSS);
      }],

      ["GET", /^\/api\/summary$/, async (req, res) => {
        const user = await ctx.sessionUser(req);
        if (!user) return json(res, 401, { error: "no session" });
        const { where, params } = taskPerimeter(user);
        const row = await ctx.db.get(
          `SELECT COUNT(*) AS open FROM Task t
             LEFT JOIN TaskStatus s ON s.id = t.statusId
            WHERE ${where} AND t.assigneeId = ? AND (s.isClosed IS NULL OR s.isClosed = 0)`,
          ...params, user.id,
        );
        json(res, 200, { name: user.name, open: row.open });
      }],
    ],
  };
}
```

Three things to notice:

- **Routes are a table**: `[method, regexp, handler]`. The handler receives
  Node's `req` and `res`, the regexp match and the parsed URL. The path is
  relative to the plugin: `/api/summary` answers at
  `/plugins/Hello/api/summary`.
- **`ctx.sessionUser(req)` is the real authentication** of KeelOps. The core
  already refuses requests without a session before they reach the plugin
  (unless a path is declared public); the plugin asks *who* the person is.
- **`ctx.db` reads the KeelOps database** — here, through a connection that
  cannot write. `taskPerimeter` is a conservative visibility filter: when in
  doubt it hides. For what the core itself decides, use the
  [core doors](07-core-doors.md).

## 4. The page

Anything in `staticDir` is served as it is. The page links the application's
stylesheet and the two scripts the core serves to every plugin:

```html
<!-- plugins/Hello/ui/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="base.css">
  <script src="sdk/tema.js"></script>
  <style>
    body { margin: 0; padding: 24px; background: var(--carta); color: var(--inchiostro); font: var(--font); }
    .card { background: var(--rilievo); border: 1px solid var(--filo); border-radius: var(--raggio); padding: 20px; }
  </style>
</head>
<body>
  <div class="card"><h1 id="title">Hello</h1><p id="line"></p></div>
  <script type="module" src="app.js"></script>
  <script src="sdk/riquadro.js" defer></script>
</body>
</html>
```

```js
// plugins/Hello/ui/app.js
const r = await fetch("api/summary");
const { name, open } = await r.json();
document.getElementById("title").textContent = `Hello ${name}`;
document.getElementById("line").textContent = `You have ${open} open tasks.`;
```

- `sdk/tema.js` makes the page follow the theme the person is looking at
  (light or dark), live.
- `sdk/riquadro.js` tells the application how tall the page is, when it is
  shown inside a panel.
- **No inline scripts.** Production runs with `script-src 'self'`: an inline
  `<script>` is silently not executed. Put the code in a file.
- Paths are **relative** (`api/summary`, not `/api/summary`): the page is
  served under `/plugins/Hello/`.

## 5. Load it

Add the plugin to `PLUGINS` in the development server's `.env` and restart:

```bash
PLUGINS=TasksMap,Personale,Hello
```

The log says `plugin "Hello" caricato su /plugins/Hello/` (loaded on…). A new
entry, **Hello**, appears in the menu; it opens your page inside the
application at `/estensioni/Hello`. If something is wrong the log says which
plugin and why, and the rest of KeelOps starts anyway.

## 6. Where to go next

- Store data of your own: declare a `nick` and create `plugin_hello_*`
  tables — [Data](04-data.md).
- Show up where the work is, not only in the menu: a button in the project
  page, a tile in the dashboard, a button in the top bar —
  [Pages](05-pages.md).
- Create tasks, attach generated files, own a group of people —
  [Working with the core](07-core-doors.md).
- Summarise the work with the local models — [Local AI](06-local-ai.md).
- Before shipping: [Security](08-security.md) and
  [Testing and shipping](09-testing-and-shipping.md).
