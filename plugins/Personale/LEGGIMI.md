# Personale — le bacheche personali, come plugin

*La descrizione completa, in inglese, è in `README.md`; qui il riassunto.*

Le kanban di ciascuno: colonne a scelta, template, orario, archiviazione. Era
una funzione del core (`modules/boards/`, `features/boards/`); dal 05/09/2026 è
un plugin che **possiede i propri dati** — il primo scritto sul contratto nuovo
(`plugins/LEGGIMI.md`, «Dati propri: le tabelle del plugin»). Il piano
completo, con le misure e le verifiche, è in `plan/plugin-personale.md`.

## Le tabelle

Sei, tutte `plugin_personale_*`, create e migrate dal plugin (`lib/schema.mjs`):

| tabella | cosa tiene |
|---|---|
| `config` | `plugin_version`, `schema_version`, e le impostazioni (la crea l'SDK, per prima) |
| `owner` | chi ha già ricevuto la bacheca di benvenuto «Mia» — una volta sola |
| `board` | le bacheche, con proprietario e posizione delle schede |
| `status` | le colonne di ogni bacheca (una iniziale, almeno una chiusa) |
| `task` | le card: titolo, descrizione, scadenza e orario, assegnatario, chiusura, archiviazione |
| `activity` | lo storico delle card |

Le chiavi esterne puntano al core (`User`) e mai il contrario. Le date sono
stringhe ISO su entrambi i motori: il travaso le copia com'è.

## Le regole

Quelle di sempre, una per una, con la loro prova in `selftest.mjs`: bacheca
privata (l'altro utente non la vede, 404); «Mia» al primo accesso e non più se
la si elimina; template con un solo stato iniziale e almeno uno chiuso; vincoli
sulle colonne (nomi distinti, niente colonna eliminata se ha card); card nata
nella colonna iniziale assegnata e supervisionata da chi la crea; `closedAt`
entrando in una colonna chiusa; orario; archiviazione; cancellazione definitiva
(mai cestino); nome doppio → 409.

## Le API

Sotto `/plugins/Personale/api/`, le stesse forme di prima:

```
GET    boards                       le mie bacheche, con le colonne
POST   boards                       { name, template }
PUT    boards/order                 { order: [id…] }
PATCH  boards/:id                   { name }
DELETE boards/:id
PUT    boards/:id/statuses          { statuses: [{ id?, name, color, isInitial, isClosed }…] }
GET    boards/:id/tasks?includeArchived=1
POST   boards/:id/tasks             { title, description?, boardStatusId?, assigneeId?, supervisorId?, dueDate?, dueTime? }
PATCH  boards/:id/tasks/:taskId     gli stessi campi, più archived
DELETE boards/:id/tasks/:taskId
GET    utenti                       chi può ricevere una card (interni, attivi)
GET    dashboard[?gruppo=…]        le mie card aperte, per il riquadro nella giornata (o un gruppo solo)
GET    gruppi                      quante card per gruppo della giornata: le pastiglie «Personali»
```

Dal 06/09/2026: filtri per bacheca (testo in titolo e descrizione, colonna,
scadenza) ricordati in `localStorage`; la pastiglia «Personali» nei gruppi
della giornata (`anchors.dashboardGroups`); la riga nel riepilogo del mattino
(`riepilogoMattutino`, in sei lingue); la pagina in it/en/fr/de/es/pt.

## Modo autonomo e selftest

`node server.mjs` avvia il plugin da solo (sviluppo), su una **copia** del
database: a differenza degli altri plugin scrive, quindi apre il file in
scrittura. `node selftest.mjs <copia.db>` fa il giro intero delle regole.
