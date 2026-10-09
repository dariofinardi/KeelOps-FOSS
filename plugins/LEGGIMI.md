# I plugin di KeelOps

I plugin sono **caricati dentro il processo del core** (side-loaded): una riga
nell'`.env` di KeelOps — `PLUGINS=TasksMap,mcp` — e il porta-plugin
(`apps/server/src/plugins/plugin-host.ts`) li monta su `/plugins/<nome>/…`.
Niente processi separati, niente nginx, niente token: le API sono **chiamate di
funzione locali**, l'autenticazione è quella vera del core, e la sicurezza sta
nel codice — ogni rotta applica il perimetro di visibilità dell'utente. Le API
HTTP esistenti (l'integrazione osTicket) non c'entrano e non cambiano.

| plugin | cosa fa |
|---|---|
| `TasksMap/` | la mappa dei task di un progetto: temi, gerarchia, finestre temporali (tabella `plugin_tasksmap_vettore`) |
| `Personale/` | le kanban personali di ciascuno (tabelle `plugin_personale_*`) |
| `mcp/` | server MCP con OAuth2 per collegare Claude, ChatGPT, Mistral |
| `MCP-pro/` | la versione pro del connettore, in un repository a parte (collegata qui con un symlink) |
| `Presenze/` | il calendario delle presenze e assenze: l'interfaccia del registro delle assenze del core (`Absence`, `/api/absences`); stesso repository a parte di MCP-pro |

## keelops-sdk

**La documentazione per chi scrive plugin** sta in `keelops-sdk/docs/` (dal
24/09/2026): undici capitoli in inglese — guida al primo plugin, manifesto,
contesto, dati, pagine, AI locale, porte del core, regole, prove e rilascio,
riferimento completo dell'API — pubblicati anche su keelops.it/sdk/docs/. Questo
file resta il **contratto**, in italiano, con il perché delle scelte; quando si
cambia qualcosa qui, si cambia anche là. L'esempio della guida lo esegue per
davvero `apps/server/test/sdk-docs-example.test.ts`.


`keelops-sdk/` è l'**SDK dei plugin**: i moduli che ogni plugin importa con un
percorso relativo, niente da installare. Contiene l'**astrazione del
database** (`database.mjs`: un driver con `all`/`get`/`close` **asincroni** e i
dialettismi dietro `db.sql.*`). I driver sono due: `openDatabase(percorso)` apre il
file SQLite per conto suo, in sola lettura e col busy timeout per convivere col WAL;
`borrowedDriver({dialect, query})` sta sopra la connessione di **qualcun altro** —
quella del core, che parla già al motore giusto — e la usa senza dover sapere come ci
si collega. Il prestito ha un prezzo: quella connessione, a differenza della nostra,
saprebbe scrivere, quindi il driver prestato **rifiuta tutto ciò che non è una
SELECT**, e rimette le righe nella forma di sempre (le date come stringhe ISO, i
`COUNT()` come numeri invece che BigInt, che `JSON.stringify` rifiuterebbe).

L'interfaccia è **asincrona**, e vale la pena dire perché, visto che una lettura
SQLite risponde in un decimo di millisecondo: `node:sqlite` risponde sul posto, ogni
client MariaDB per Node risponde con una promessa, e nessuna astrazione trasforma
l'una nell'altra. Far attendere il caso veloce non costa niente ed è l'unica forma in
cui ci stanno entrambi. È costata `await` in 41 punti dei due plugin: «un file driver
e una voce nel registro», come diceva questo paragrafo, era una previsione ottimistica.

Il resto dell'SDK: il motore
HTTP a tabella di rotte (`http.mjs`: un solo dispatcher per il modo side-loaded
e per quello autonomo), la pulizia del testo (`text.mjs`), il riconoscimento
della sessione per il modo autonomo (`session.mjs`), il perimetro conservativo
di visibilità (`perimeter.mjs`), il magazzino di estensione (`extension.mjs`) e
**l'aspetto KeelOps** (`ui.mjs`: `BASE_CSS`, che dal 07/09/2026 **eredita i
colori dell'applicazione** — la prima riga tira dentro `/api/tema.css`, che il
core genera dalla stessa sorgente dell'interfaccia (`packages/shared/src/tema.css`)
**già risolta** per chi guarda: chiaro, scuro, o la media query se ha scelto
«automatico». I nomi storici (`--carta`, `--inchiostro`, `--filo`, `--rilievo`,
`--accento`) restano, mappati sui token del core, e i valori di sempre fanno da
ripiego dove il foglio del core non si raggiunge (plugin in modo autonomo).
**Il tema è quello che la persona sta vedendo**, non quello del sistema
operativo: `TEMA_SCRIPT` guarda la classe `dark` del documento che ospita la
cornice — stessa origine — e la rispecchia su `data-tema` di `<html>`, seguendola
mentre cambia. Le pagine con colori propri li scrivono su `[data-tema="dark"]`,
mai dentro `prefers-color-scheme`. Si serve come `base.css`, con una rotta
gemella `tema.js` per lo script; una pagina resa dal server se li mette in
testa (`<style>${BASE_CSS}</style><script>${TEMA_SCRIPT}</script>`). **Vale per
tutti i plugin, liberi e a pagamento**: TasksMap, Personale, il connettore MCP
(le sue cinque pagine, consenso OAuth compreso), MCP-pro e Presenze — nessuno
guarda più `prefers-color-scheme`, tranne come ripiego quando la pagina è
aperta da sola e non c'è un'applicazione da seguire. Il font di
sistema, `CARD_CSS` per le pagine a card centrata, `ICONS` con i glifi lucide
dell'app — le pagine renderizzate dal server li interpolano, una UI statica
serve `BASE_CSS` da una piccola rotta e la collega, come `/base.css` di
TasksMap). Niente webfont di proposito: il prodotto usa i font di sistema.

**Convenzione di lingua:** nel codice dei plugin — funzioni, metodi, commenti —
si scrive in **inglese**. In italiano restano i testi visti dall'utente (pagine,
messaggi, didascalie) e questi LEGGIMI.

## Il contratto di un plugin

Ogni cartella `plugins/<nome>/` espone `plugin.mjs`:

```js
export const manifest = { /* nome, versione, permessi, ui, salute */ };
export function create(ctx) {
  return { routes, staticDir, wellKnown };   // rotte in stile tabella
}
```

`ctx` arriva dal core: `db` (in sola lettura; scrive nelle proprie tabelle chi
dichiara un `nick`, vedi sotto), `dataDir`, `keelopsUrl`, `ollamaUrl`,
`publicUrl`, `sessionUser(req)` (l'autenticazione vera, asincrona).
Dal 22/09/2026 **i task**: `tasks.create(userId, { title, description?, projectId?, assigneeId?,
supervisorId?, dueDate?, statusId?, activityTypeId? })` crea un task passando dal servizio del core
(`createTaskAs`), quindi con le sue regole — permesso di chi crea, stato iniziale della categoria,
referente di default, notifiche, registro attività — e nella dimostrazione non scrive;
`tasks.read(userId, taskId)` e `tasks.readMany(userId, ids)` lo rileggono con il perimetro di
visibilità del core: quello che quella persona non vedrebbe torna `null`, **non un errore**. Un
plugin non scrive mai in `Task` da sé: il cancello glielo impedisce, ed è la ragione per cui questa
porta esiste.
Dal 22/09/2026 anche **i gruppi**: `groups.ensure({ chiave, nome, area? })` crea, **una volta**, il
gruppo di quel plugin — chi fa quel mestiere — e lo torna; `groups.read(chiave)` lo ritrova (o `null`
se non c'è più), `groups.members(chiave)` dice chi c'è dentro. L'identità è la coppia (nick del
plugin, `chiave`), **mai il nome**: l'amministratore lo rinomina quando vuole e il plugin lo ritrova
lo stesso. Se esiste già un gruppo con quel nome e nessuno lo rivendica, `ensure` lo **adotta**
invece di crearne un secondo — i membri non si toccano. Se qualcuno lo cancella, il plugin
**non lo fa risorgere**: se ne accorge da `read` e lo dice in pagina. Nel manifesto,
`ui.soloGruppo: true` toglie la voce dal menù a chi nel gruppo non c'è (le ancore restano a tutti:
chi si trova assegnata un'azione deve poter leggere da dove viene).

### La scheda in Sistema, e l'interruttore

Dal 23/09/2026 la pagina **Sistema** elenca al super admin ogni plugin della
cartella: quelli montati e quelli presenti ma non installati (letti dal loro
`manifest.json`). Del manifesto usa `titolo`, `versione`, `schemaVersion`,
`licenza` e due campi pensati per questo:

- `copyright` — una riga, come va stampata: `"© 2026 Jugaad s.r.l."`;
- `sommario` — una frase per lingua, `{ it, en, fr, de, es }`: la pagina la
  mostra nella lingua di chi legge, poi l'inglese, poi l'italiano. Senza
  `sommario`, vale la prima frase di `descrizione` (in italiano).

Da lì un plugin installato si **spegne e si riaccende a caldo** (la scelta sta
in `AppSetting` `plugins.disattivati`). Spento: le sue rotte e i well-known
rispondono 404 `PLUGIN_DISABLED`, sparisce da `/api/plugins/ui` (menù e
ancore) e dal riepilogo del mattino. **Tabelle e dati restano**, e `create()`
non si richiama: i timer che il plugin ha avviato si fermano solo al prossimo
riavvio. Installare resta un'altra cosa: `installa.sh` e un riavvio.

### Le edizioni: `edizione`, `richiede`, `usa`

Dall'08/10/2026 KeelOps ha due edizioni, community e commerciale (vedi
`plan/edizioni.md`). Il plugin le vede in `ctx.edizione` e `ctx.funzioni`
(l'insieme dei moduli presenti, più `ollama`); le porte che dipendono da un
modulo assente valgono `null` (`ctx.timesheet`, `ollamaUrl`). Nel manifesto:

- `edizione: "commerciale"` — non si monta su un core community;
- `richiede: ["timesheet", …]` — non si monta se manca una di quelle funzioni;
- `usa: [...]` — si monta comunque e si adatta: è un'informazione, non un controllo.

Un plugin in `PLUGINS` che non si monta per l'edizione lo dice nel log e
nella sua scheda in Sistema («Non disponibile in questa edizione», con il
motivo). Oggi: Presenze, QABox, QuoteDOCX, Rapportini e MCP-pro sono
`commerciale`; TasksMap `usa` i modelli, mcp le statistiche delle ore e i ticket
quando ci sono. Le ore in sé ci sono sempre: la griglia del timesheet è del
nucleo (08/10/2026); la funzione `timesheet` è il timesheet commerciale completo.
La guida per chi scrive un plugin è in `keelops-sdk/docs/02-manifest.md`.

### Il tunnel fra plugin: gli strumenti

Dal 23/09/2026 un plugin può **offrire strumenti** agli altri: `create()`
restituisce anche `strumenti`, un elenco di

```js
{ nome: "cruscotto",                       // minuscole, cifre, _ (max 49)
  descrizione: "…per un modello linguistico…",
  parametri: { type: "object", properties: { … } },   // JSON Schema
  esegui: async (utente, parametri) => risposta }     // utente: quello di ctx.sessionUser
```

e un plugin che nel manifesto chiede **`plugins:strumenti`** li trova con
`ctx.plugins.strumenti()` (chi non lo chiede riceve `ctx.plugins === null`).
Ogni strumento esce col prefisso del plugin che lo offre (il nick, o il nome:
`qabox_cruscotto`) e con `esegui(userId, parametri)`. Tre regole, ed è per
queste che il tunnel passa dal core:

- **si dichiara, non si scansiona**: di un plugin si vede solo ciò che offre;
  i controlli di accesso restano dentro la sua `esegui`;
- **l'identità la mette il core**: chi chiama passa un id, e chi risponde
  riceve l'utente letto dal database (attivo e interno) — o un errore;
- **un plugin spento sparisce anche da qui**, e il registro si legge alla
  chiamata: l'ordine di `PLUGINS` non conta.

Oggi lo usano QABox (offre le sue schede, in sola lettura) e MCP-pro (le
mette a disposizione degli assistenti).

### Il bottone nella barra, e i segnali

`ui.barra: { icona, stato, pannello }` mette un bottone nella barra in alto,
fra la campanella e il profilo. `icona` è un file della cartella statica
(monocromatico, come per il menù) o un nome del set; `stato` è una rotta del
plugin che risponde `{ tono, lampeggia, titolo }` — `tono` fra `acceso`
(verde), `spento` (grigio), `bloccato` (ambra) e `nessuno`, `lampeggia` fa
battere il pallino, `titolo` è il suggerimento già tradotto; `pannello` è una
pagina del plugin, aperta in un riquadro sotto il bottone (con
`sdk/riquadro.js` si prende l'altezza giusta).

Il core rilegge lo stato ogni minuto, alla chiusura del pannello e quando il
plugin lo chiede con **`ctx.segnali.invia(userId, dati)`**: un evento sul
canale in tempo reale del core, solo a quella persona, che fa rileggere il
suo bottone. Niente coda: chi non è collegato non lo riceve.

### Il marchio: cosa un plugin lascia nel core

**Ogni riga che un plugin crea in una tabella del core porta il suo nome**
(22/09/2026). `Group`, `Task` e `Attachment` hanno `pluginNick` (chi l'ha
chiesta) e `pluginRef` (l'id del record dentro il plugin, o la chiave del
gruppo). Il nick **lo mette il core**, legando ogni porta al plugin che la
riceve: nessun plugin può firmarsi col nome di un altro, e chi passa un `ref`
sta solo dicendo a cosa corrisponde di suo.

Serve alla disinstallazione, che ancora non c'è: il giorno che si potrà
togliere un plugin, la domanda «cosa lascia dietro?» avrà una risposta in
numeri (`inventarioDelPlugin(nick)` la dà già) invece di un'alzata di spalle,
e chi disinstalla potrà scegliere se tenere le righe, togliere loro il marchio
o cancellarle. Una riga **che il plugin non ha creato** non si marca: una NC
attaccata a un ticket nato dal portale lascia il ticket com'era.

Dal 21/09/2026 `perimeter.canEditTask(userId, taskId)` (il predicato del core, secco: un permesso
negato non è un guasto) e `attachments.write(userId, taskId, { name, mimeType, bytes, replaceAttachmentId? })`,
che crea — o **sostituisce tenendo lo stesso id**, se l'allegato è di quel task — un allegato FILE a nome
dell'utente: vale la regola del core (chi può modificare il task può allegare), nella dimostrazione non
scrive, e l'attività finisce nel registro come un caricamento qualsiasi.
Dal 05/09/2026 anche `attachments.read(userId, attachmentId, { bytes? })`: il
core applica la **sua** regola di accesso (chi vede il task legge il file) e
consegna nome, tipo, dimensione, l'indirizzo per i collegamenti, il testo
estratto (PDF, Word, file di testo) e — se chiesti e sotto gli 8 MB — i byte.
Fuori dal core (plugin autonomo) la funzione non c'è: il plugin lo dice.
`wellKnown` elenca i documenti OAuth da esporre anche nella forma per
inserzione della RFC 8414.

**Ogni rotta sotto `/plugins/<nome>/` passa dalla guardia di sessione del core**
(dal 05/09/2026): senza sessione risponde 401 prima ancora di arrivare al plugin.
Le eccezioni le dichiara il manifesto in `pubblici`, un elenco di prefissi
relativi alla radice del plugin, con un metodo davanti se serve — per `mcp`:
`["OPTIONS /", "POST /", "DELETE /", "/mcp", "/.well-known/", "/oauth/register",
"/oauth/authorize", "/oauth/token", "/oauth/revoke"]` (il protocollo e l'OAuth
si autenticano da sé, col bearer). Il percorso di `health` è pubblico da sé.
Il plugin continua a chiedere `sessionUser(req)` dove gli serve l'utente: la
guardia dice *se* si entra, non *chi* è.

**Le letture passano da una connessione che non sa scrivere**: su SQLite un
secondo accesso al file in sola lettura, su MariaDB una sessione `READ ONLY`
del motore. Il cancello sul testo (`sql-targets.mjs`) resta per l'errore
leggibile, non come unica difesa. Le scritture di un plugin con nick vanno
sulla connessione del core, col prefisso obbligato.

Il **manifesto** può dichiarare la propria presenza nell'interfaccia del core:
`ui: { voce, icona }` diventa una voce di menu in coda alle aree (icona dal set
lucide già in uso: `share-2`, `bot`, `columns-3`, o il ripiego `puzzle` — oppure
**un file del plugin**, `icona: "icona.svg"`, cercato nella sua cartella statica:
un SVG monocromatico, che il core tinge del colore del testo come le altre), resa dentro
AppShell in un iframe stessa-origine (`/estensioni/<nome>`); `anchors` dichiara **di quale
funzione il plugin è figlio** — `{ project: true }` per TasksMap (il menu a tre
puntini della pagina progetto, che lo apre con `?progetto=<id>`),
`{ profile: true }` per il connettore MCP (il menu del profilo utente),
`{ deal: true }` per chi scrive il documento di una **singola offerta**
(QuoteDOCX: il bottone «Word» in coda a Drive, Link e File negli allegati
dell'offerta, per chi la può modificare, apre il plugin con `?offerta=<id>`;
dal 21/09/2026, vedi «Un bottone dedicato per un'ancora»), `{ docx: true }` per chi sa **aprire un .docx
allegato** (il bottone Word sulla riga dell'allegato, per chi può modificare il task, apre il plugin con
`?allegato=<id>&task=<id>`: il plugin se lo fa dare da `ctx.attachments.read(..., { bytes: true })`, lo
importa e lo riscrive al posto suo con `ctx.attachments.write`); `{ task: true }` per chi genera lavoro e vuole dire **da dove viene un task**
(QABox: «azione correttiva della NC-41», un riquadro dentro il pannello di
dettaglio, aperto con `?task=<id>`; dal 22/09/2026); le aree possibili oggi:
`project`, `profile`, `deal`, `deals`, `docx`, `task`, `boards`, `personal`,
`timesheet`. Ogni pagina dichiara la propria area montando il menu, e un menu
senza plugin della sua area non compare. `ui.menu: false` tiene il plugin fuori
dal menu principale (è il default sensato per i plugin contestuali). Il core
scopre tutto da `GET /api/plugins/ui`.

## Dati propri: le tabelle del plugin

Dal 05/09/2026 un plugin **può possedere tabelle** nel database di KeelOps, e
ne è responsabile per intero: le crea, le migra, le tiene. Dichiara un `nick`
nel manifesto (minuscole, cifre, trattino basso: `personale`) e da lì in poi le
sue tabelle si chiamano `plugin_<nick>_<tabella>`. Nient'altro gli è
concesso: il driver che riceve lascia passare una scrittura solo se **ogni**
tabella scritta porta il suo prefisso, e lo decide leggendo lo statement
(`keelops-sdk/sql-targets.mjs`), non la prima parola — `WITH x AS (…) DELETE
FROM Task` comincia con `WITH` ed è SQLite valido. Il rifiuto dice quale nome ha
fermato. Vale anche per `all()`/`get()`: una lettura travestita non passa.

```js
export const manifest = { nome: "Personale", nick: "personale", versione: "1.0.0", schemaVersion: 1, ui: { … } };
export function create(ctx) {
  return {
    routes, staticDir,
    migrate: (db, from) => applyMigrations(db, "personale", [
      { version: 1, up: (d) => d.run("CREATE TABLE plugin_personale_board (…)") },
    ], from),
  };
}
```

Tre cose che il core chiede **prima di montare** un plugin con un nick:

1. **`plugin_<nick>_config` esiste, e per prima.** Chiave/valore per le
   impostazioni del plugin, più due righe che non sono facoltative:
   `plugin_version` (il codice che ha scritto l'ultima volta) e
   `schema_version` (la struttura delle sue tabelle). Il core la crea vuota se
   manca (`pluginConfig(db, nick).ensure()`), e la pagina Sistema la mostra.
2. **La struttura in tabella non è più avanti del codice.** Se lo è — un
   plugin riportato indietro — il core non lo monta, invece di farlo girare su
   tabelle che non capisce.
3. **Se è indietro, `migrate(db, from)` la porta a `schemaVersion`**, e dopo
   la chiamata la tabella DEVE dire quel numero. `applyMigrations` dell'SDK
   applica i passi mancanti in ordine e scrive `schema_version` dopo
   **ciascuno**: un passo a metà lascia la versione dell'ultimo riuscito, che è
   la verità (su MariaDB un DDL committa da sé: «tutto in una transazione» non
   è una promessa che un livello neutro possa mantenere).

Le chiavi esterne vanno in un verso solo: dal plugin al core
(`ownerId → User.id`, con `ON DELETE CASCADE`), mai dal core a un plugin — un
plugin spento non deve rompere una cancellazione. Il DDL si scrive dietro
`db.sql.*` o in ANSI stretto, e si prova sull'altro motore con
`apps/server/scripts/mariadb/prova-plugin.ts --database <db di prova>`. Il
travaso SQLite→MariaDB copia le tabelle `plugin_%` per nome
(`scripts/mariadb/migra-dati.ts`): la destinazione la crea il plugin al primo
avvio.

Il DDL per i testi senza un limite pratico (documenti estratti, vettori in
JSON) usa `db.sql.longText()`: `TEXT` su SQLite non ha tetto, su MariaDB sono
64 KB, e lo stesso DDL entrava di qua e si troncava di là.

In modo autonomo un plugin con tabelle non può usare il driver che apre il
file in sola lettura: l'SDK gli dà `openWritableSqlite(percorso, nick)` — il
driver prestato sopra un `node:sqlite` scrivibile, con lo stesso cancello — e
`prepareOwnedTables(db, { nick, schemaVersion, migrate, version })`, che fa
quello che il core fa prima di montarlo. Sempre su una **copia** del database.

Il **DuckDB** in `data/` (`keelops-sdk/extension.mjs`) resta per i dati
usa-e-getta o analitici del plugin — cache, grafi calcolati, volumi che si
ricostruiscono — non per quelli che contano. Dal 06/09/2026 è un'API vera,
con la forma del driver del database: `openExtensionStore(dataDir, { from:
import.meta.url })` dà `exec` (DDL), `all`/`get`/`run` con i `?` posizionali,
`migrate([{ version, up(store) }])` con la versione tenuta nel file
(`keelops_schema`), `version()`, `close()`; le righe tornano piane (BIGINT
come numero, date e decimali come stringhe). Il modulo `@duckdb/node-api` va
installato **nella cartella del plugin** e `from` dice all'SDK dove cercarlo.
Lo stato in `plugins/*/data/` è protetto dal deploy (escluso dal rsync, come
`/data`).

## Tutto passa dall'SDK

Un plugin **non accede da sé** a niente del core: non apre il database (né
`node:sqlite`, né Prisma, né un client MariaDB), non legge l'`.env`, non chiama
i servizi che il core presta. Il database è il driver di `ctx.db`; i file
allegati sono `ctx.attachments.read`; le credenziali Google sono `ctx.google`;
le **ore del timesheet** si aggiungono con `ctx.timesheet.aggiungi` (permesso
`timesheet:write`) e la **posta** esce con `ctx.mail.invia` (permesso
`mail:send`), dal 29/09/2026 per i rapportini — mai un SMTP proprio, mai una
scrittura in `TimeEntry`;
**Ollama è `keelops-sdk/ollama.mjs`** (`embed`, `chat`, `normalize`, `dot`) con
l'indirizzo di `ctx.ollamaUrl` — un guasto è `null`, mai un'eccezione, come
nel core. Le eccezioni ammesse sono i propri dati (`ctx.dataDir`) e le
integrazioni che sono *del plugin* (Drive per MCP-pro, con le credenziali che
il core gli presta). Una prova nel core (`test/plugins-through-sdk.test.ts`)
legge i sorgenti dei plugin e si ferma su un import proibito.

## La voce nel menù, e le ancore con contenuto

`ui` nel manifesto dice anche **dove** stare e **chi** la vede: `sezione`
(`aree` o `amministrazione`), `dopo` (la chiave di un'area — `home`, `personal`,
`tasks`, `deals`, `projects`, `tickets`, `timesheet`, `contacts`, `help` — o il
nome di un altro plugin; assente = in coda), `ruoli` (`["ADMIN", "MEMBER"]`;
assente = tutti gli interni), `soloManager`, `soloGruppo` (dal 22/09/2026: la
vede chi sta nel gruppo del plugin, e l'amministratore, che è chi ce le mette
le persone). Un valore che il core non capisce non rompe il menù: ripiega sul
default e lo dice nel log.

### Un bottone dedicato per un'ancora

Il menu a tre puntini (`PluginMenu`) è la forma generica; dove il gesto merita
un bottone con il suo nome e la sua icona — «Word» fra gli allegati
dell'offerta (21/09/2026) — la ricetta è questa, in due metà.

**Nel plugin** basta il manifesto: `anchors: { deal: true }` dice di quale
funzione è figlio, `ui.menu: false` se non ha senso nel menù principale (o
`menu: true` con `sezione`/`ruoli` se ha anche una pagina sua, come QuoteDOCX
con i modelli). La pagina legge il riferimento dalla query string
(`?offerta=<id>`) e chiede al core via `ctx.db` i permessi che le servono:
l'ancora dice *dove* si apre, non *cosa* si può fare.

**Nel core**, nella pagina che ospita il gesto (`AttachmentsSection.tsx` è
l'esempio):

1. `const editori = (usePlugins().data ?? []).filter((p) => p.anchors?.deal)`:
   i soli plugin figli di quell'ancora; l'elenco vuoto significa **niente
   bottone**, non un bottone spento — senza plugin l'interfaccia non ne parla.
2. La stessa condizione dei bottoni vicini (`task.canEdit`, `task.kind ===
   TaskKind.DEAL`…): il plugin non allarga i permessi del core.
3. Un `Button` per plugin (con più plugin sulla stessa ancora, l'etichetta è la
   `voce` del plugin), con un'icona **inline** se è di marca — `WordGlyph`,
   `GoogleDriveGlyph` — perché la CSP non ammette asset esterni e lucide non
   ha loghi di terzi.
4. Si apre `/estensioni/<nome>?<chiave>=<id>` con un link o
   `window.location.assign`, **non** con `useNavigate`: la sezione vive anche
   in alberi senza Router (i dom-test), come già fa `PluginMenu`.
5. Un dom-test che finge `usePlugins` (`vi.mock` con un elenco cambiabile) e
   prova tre cose: senza plugin il bottone non c'è; con il plugin, sul
   contesto giusto e con il permesso, c'è e apre l'indirizzo atteso; in sola
   lettura o sul contesto sbagliato non c'è.
6. La nuova ancora va nell'elenco qui sopra, con chi la apre e con quale
   query: è il contratto che un plugin legge.

Nessuna modifica lato server: `plugin-host.ts` passa `anchors` dal manifesto
a `/api/plugins/ui` così com'è, senza elenco chiuso.

### Le traduzioni delle pagine

**Il meccanismo è uno, nell'SDK** (22/09/2026): `keelops-sdk/ui.mjs` esporta
`avviaTraduzioni`, e il guscio lo serve a ogni plugin come `sdk/traduzioni.js`,
accanto a `sdk/tema.js` e `sdk/riquadro.js`. L'italiano è la chiave, la lingua è
quella scelta in KeelOps (`api/me` → `i18n.imposta(locale)`), una frase che
manca ricade sull'inglese e poi sull'italiano, `{nome}` si sostituisce. Il
plugin porta **solo i suoi cataloghi**:

```html
<script src="sdk/traduzioni.js"></script>
<script src="i18n.js"></script>   <!-- KeelOpsI18n.crea({ en: {…}, fr: {…}, de: {…}, es: {…} }) -->
```

Le etichette statiche si traducono da sole con `data-i18n`,
`data-i18n-placeholder` e `data-i18n-title` (che mette anche l'`aria-label`).
Una pagina costruita con Vite (Personale, QuoteDOCX) tiene il suo `i18n.ts`,
perché non carica script esterni; Presenze e TasksMap hanno ancora la loro
copia del meccanismo, da portare su questo. **Le cinque lingue oltre all'italiano (en, fr, de, es, pt) vanno tenute
complete**: `apps/server/test/plugins-translations.test.ts` legge ogni plugin
che trova e si ferma su una frase senza traduzione.

Un'ancora può portare **contenuto**, non solo un bottone: `PluginPanel` nel
core monta una cornice con la pagina del plugin dentro una pagina nativa (il
riquadro di un plugin nella giornata). La pagina è la stessa di sempre, aperta
con `?ancora=<nome>`; per farsi dare l'altezza giusta inserisce in fondo
`<script>${FRAME_RESIZE_SCRIPT}</script>` da `keelops-sdk/ui.mjs`. Se non ha
niente da mostrare lo dice — `postMessage({ tipo: "keelops:vuoto", vuoto: true })`
al guscio — e la cornice sparisce dalla pagina invece di restare un riquadro
vuoto (`vuoto: false` la fa tornare; 07/09/2026).

**Le card nei gruppi della giornata** (`anchors.dashboardGroups`, dal
06/09/2026): i riquadri «In ritardo», «Oggi», «Domani», «Prossimi giorni»,
«Senza scadenza» hanno una terza pastiglia, **Personali**, accanto a Miei e
Supervisionati. Il plugin risponde su `GET api/gruppi` con
`{ gruppi: { overdue, today, tomorrow, next, none } }` (la regola dei gruppi
è quella del core: prima di oggi, oggi, domani, i quattro giorni dopo, senza
data) — i numeri delle pastiglie — e, scelta la pastiglia, la sua pagina si
apre dentro il riquadro con `?ancora=dashboardGroups&gruppo=<chiave>`, senza
intestazione (quella è del riquadro). Senza plugin con quell'ancora la
pastiglia non c'è.

## Il riepilogo del mattino

È il primo aggancio del core **verso** i plugin. Il riepilogo delle 7:00
(`sendDueDigests`) chiede a ogni plugin montato se ha righe da aggiungere:
`create()` può restituire `riepilogoMattutino({ oggi })` →
`[{ userId, righe(locale) => string[] }]`, una voce per persona che ha
qualcosa da sentirsi dire, con la riga già scritta nella lingua che il core
passa (il core sa la lingua del destinatario, il plugin no). Una riga basta
da sola a far partire il riepilogo. Un plugin che risponde male o non
risponde in dieci secondi non lo ferma: la sua parte manca e il log lo dice.
Personale lo usa per «Bacheche personali: 3 in ritardo, 1 in scadenza oggi».

## Modo autonomo

Ogni plugin ha anche `server.mjs` (processo a sé, comodo in sviluppo) e
`selftest.mjs`, la prova end-to-end da lanciare **contro una copia** del
database: `node selftest.mjs <copia.db>`. Il dispatcher è lo stesso del modo
side-loaded: i due modi non possono divergere.
