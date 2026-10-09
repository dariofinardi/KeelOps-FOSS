# TasksMap plugin

The network of a project's tasks, computed from the data and never drawn by hand:
**themes** from the text (bge-m3 embeddings via Ollama, or tf-idf when Ollama is
silent), **hierarchy** declared with the arrows, **variable time windows**
(1/7/14/28 days), **co-work** (same person, same day) and **parent
suggestions** (nearby openings + overlapping lifetimes + text, with the
direction taken from the order of creation — proposals, never automatic edges).

The thresholds come from measurements (internal design notes:
`plan/misure-modelli.md`) and from the plugin study: time edges also require
textual similarity because dates alone are wrong 94 times out of 100
(measured).

## Usage

In production the plugin is **side-loaded**: in the KeelOps `.env` all it takes
is `PLUGINS=TasksMap` and the map answers on
`https://crm.example.com/plugins/TasksMap/` — no separate processes, no
nginx. In development it can also run on its own:

```bash
cp .env.example .env   # and fill it in
node server.mjs        # nothing to install: just Node ≥ 22
```

Each user sees **only the projects and tasks within their perimeter**
(conservative version: when in doubt it denies — `plugins/keelops-sdk/perimeter.mjs`).
Clusters can be selected from the legend (with the theme's detail), click a node
for the task's detail and the "Apri in KeelOps" link, drag, zoom, Esc to close.

## What is kept, and where (since 0.2.0)

The plugin has a `nick` (`tasksmap`) and **a table of its own**,
`plugin_tasksmap_vettore`: the bge-m3 vector of each task, with the fingerprint
of the text it came from and the model. A vector depends only on the task's
text: it is shared by everyone who sees the task and stays valid until the
title or description changes (the fingerprint tells). With Ollama off the
vectors are tf-idf, computed on the spot — the vocabulary is the set of tasks in
front of that user — and nothing is written.

The **graph is never kept whole**: themes, edges and suggestions are computed on
every request from the vectors of the tasks _that user_ sees, and stay in
memory for ten minutes under the fingerprint of that exact set (which tasks, and
the latest `updatedAt`). The file cache of versions 0.1.x, one graph per
project under the project's name, carried one person's perimeter over to the
next, and did not notice a changed title: it is gone, and the plugin deletes the
old `grafo-*.json` files in the data dir at startup.

The page polls `api/mappa/<id>/impronta` every half minute and reloads by
itself when the set has changed (task new, closed, renamed, or made visible).
`?ricalcola=1` throws away the in-memory copy.

The migrations live in `lib/schema.mjs`; standalone mode (`server.mjs`) uses
the SDK's writable SQLite driver, with the same gate as the core: it must be
run on a **copy** of the database.

Not done, and noted: **asynchronous** computation (answer at once with the old
map and recompute behind it) — today the first opening of a large project
waits for the embeddings with the progress bar; later openings, with the
vectors in the table, answer in half a second.

## Testing

```bash
node selftest.mjs /path/to/a/COPY/of/the/db              # tf-idf
OLLAMA_URL=http://127.0.0.1:11434 node selftest.mjs …    # bge-m3, vectors in the table
```

The core also has the browser test (`e2e/plugin-tasksmap.spec.ts`): from the
project's ⋯ menu to the map in the frame, with the demo project's tasks.
