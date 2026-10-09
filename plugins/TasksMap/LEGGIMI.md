# Plugin TasksMap

La rete dei task di un progetto, calcolata dai dati e mai disegnata a mano:
**temi** dal testo (embedding bge-m3 via Ollama, o tf-idf se Ollama tace),
**gerarchia** dichiarata con le frecce, **finestre temporali variabili**
(1/7/14/28 giorni), **co-lavoro** (stessa persona, stesso giorno) e
**suggerimenti di parentela** (aperture vicine + vita sovrapposta + testo, col
verso dall'ordine di nascita — proposte, mai archi automatici).

Le soglie vengono dalle misure di `plan/misure-modelli.md` e dello studio plugin:
gli archi temporali chiedono anche somiglianza testuale perché le sole date
sbagliano 94 volte su 100 (misurato).

## Uso

In produzione il plugin è **side-loaded**: nell'`.env` di KeelOps basta
`PLUGINS=TasksMap` e la mappa risponde su
`https://crm.example.com/plugins/TasksMap/` — niente processi separati, niente
nginx. In sviluppo può girare anche da solo:

```bash
cp .env.example .env   # e compilare
node server.mjs        # niente da installare: solo Node ≥ 22
```

Ogni utente vede **solo i progetti e i task del suo perimetro** (versione
conservativa: nel dubbio nega — `plugins/keelops-sdk/perimeter.mjs`). Cluster
selezionabili dalla legenda (con dettaglio del tema), clic su un nodo per il
dettaglio del task e il collegamento «Apri in KeelOps», trascinamento, zoom,
Esc per chiudere.

## Cosa si tiene, e dove (dalla 0.2.0)

Il plugin ha un `nick` (`tasksmap`) e **una tabella sua**,
`plugin_tasksmap_vettore`: il vettore bge-m3 di ogni task, con l'impronta del
testo da cui è nato e il modello. Un vettore dipende solo dal testo del task:
lo condividono tutti quelli che vedono il task e vale finché il titolo o la
descrizione non cambiano (l'impronta lo dice). Con Ollama spento i vettori sono
tf-idf, calcolati sul posto — il vocabolario è l'insieme dei task davanti a
quell'utente — e non si scrive niente.

Il **grafo non si tiene mai intero**: temi, archi e suggerimenti si calcolano a
ogni richiesta dai vettori dei task che *quell'utente* vede, e restano in
memoria dieci minuti sotto l'impronta di quell'insieme esatto (quali task, e
l'ultimo `updatedAt`). La cache su file delle versioni 0.1.x, un grafo per
progetto sotto il nome del progetto, portava il perimetro di una persona a
quella dopo, e non si accorgeva di un titolo cambiato: è sparita, e i vecchi
`grafo-*.json` nella data dir li cancella il plugin all'avvio.

La pagina interroga ogni mezzo minuto `api/mappa/<id>/impronta` e si ricarica
da sé quando l'insieme è cambiato (task nuovo, chiuso, rinominato, o reso
visibile). Con `?ricalcola=1` si butta via la copia in memoria.

Le migrazioni stanno in `lib/schema.mjs`; il modo autonomo (`server.mjs`) usa
il driver SQLite scrivibile dell'SDK, con lo stesso cancello del core: va
lanciato su una **copia** del database.

Non fatto, e annotato: il calcolo **asincrono** (rispondere subito con la mappa
vecchia e ricalcolare dietro) — oggi la prima apertura di un progetto grande
aspetta gli embedding con la barra di avanzamento; le aperture dopo, con i
vettori in tabella, rispondono in mezzo secondo.

## Prova

```bash
node selftest.mjs /percorso/di/una/COPIA/del/db          # tf-idf
OLLAMA_URL=http://127.0.0.1:11434 node selftest.mjs …    # bge-m3, vettori in tabella
```

Nel core c'è anche la prova dal browser (`e2e/plugin-tasksmap.spec.ts`): dal
menu ⋯ del progetto alla mappa nella cornice, con i task del progetto demo.
