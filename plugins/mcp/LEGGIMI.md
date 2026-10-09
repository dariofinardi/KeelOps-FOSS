# Plugin MCP (versione base, senza filtro PII)

Un server [MCP](https://modelcontextprotocol.io) remoto con OAuth 2.1 che permette a
Claude, ChatGPT e Mistral di **leggere** KeelOps. Nessuno strumento scrive.

**L'identità è dell'utente, non del plugin.** Il consenso riconosce la sessione
KeelOps (stesso dominio via nginx), il token nasce legato a quell'utente e ogni
strumento risponde dentro il suo perimetro: un assistente collegato col mio token
vede ciò che vedo io — le offerte altrui e le ore degli altri restano fuori
(collaudato in `selftest.mjs`). Gli utenti esterni (portale, monitor) non possono
autorizzare nulla.

Questa è la versione **base, per client fidati**: i testi passano all'assistente
così come sono. La versione con pseudonimizzazione (`gliner2_pii + mcp`) è un
prodotto separato, previsto a pagamento.

## Avvio

In produzione il plugin è **side-loaded** nel core: `PLUGINS=mcp` nell'`.env`
di KeelOps e risponde su `/plugins/mcp/…`. In sviluppo può girare da solo:

```bash
cp .env.example .env   # e compilare
node server.mjs
```

Niente da installare: solo Node ≥ 22. Il database è aperto in **sola lettura**.

## Esposizione pubblica (obbligatoria per i provider)

Claude, ChatGPT e Mistral vogliono un indirizzo **HTTPS raggiungibile da internet**.
Il plugin è erogato **direttamente dal virtual host di KeelOps**: nell'`.env` del
core basta `PLUGINS=mcp` e il plugin risponde su
`https://crm.example.com/plugins/mcp/…` — nginx non va toccato. Nel `.env` del
plugin: `MCP_PUBLIC_URL=https://crm.example.com/plugins/mcp`.

Il core serve anche la forma "per inserzione" dei metadati
(`/.well-known/oauth-authorization-server/plugins/mcp`), quella che i client
OAuth usano quando l'issuer ha un percorso (RFC 8414).

## Collegare gli assistenti

| assistente | dove | cosa inserire |
|---|---|---|
| **Claude** (claude.ai / Desktop) | Settings → Connectors → *Add custom connector* | `https://crm.example.com/plugins/mcp` |
| **ChatGPT** | Settings → Connectors (serve la Developer mode / piani a pagamento) | stesso URL |
| **Mistral Le Chat** | Intelligence → Connectors → *Add MCP connector* | stesso URL |

In tutti i casi il provider scopre da sé i metadati OAuth, si registra da solo
(registrazione dinamica RFC 7591), apre la pagina di consenso — dove serve una
sessione KeelOps attiva nel browser — e da lì in poi usa il token a nome tuo.
Per ChatGPT esistono anche i due strumenti `search` e `fetch` con le forme che i
suoi connettori pretendono.

## Strumenti esposti

`search` · `fetch` · `cerca_task` · `progetti` · `scadenze` · `storico_stati`
(i cambi di stato: di un task, o degli ultimi giorni sui task in cui l'utente ha
un ruolo) · `mio_timesheet` (le ore registrate DALL'utente, giorno per giorno —
sempre e solo le proprie) · `ore_per_progetto` · `stato_offerte` (pipeline per
fase, vinte, perse con i **motivi delle perdite** raggruppati, tasso di vittoria)
· `offerte` (elenco filtrabile per esito, fase, azienda, testo, giorni: fase,
valore, probabilità, azienda, motivo della perdita) · `dettaglio_offerta` (una
sola: referente, storia dei passaggi di fase con chi/quando/motivo, cambi di
valore, chat, task collegati, lettura degli allegati) — tutti in sola lettura,
tutti nel perimetro dell'utente. Ogni elenco di task riporta `offerta` (fase,
esito, motivo) quando il record è un'offerta.

**Per l'analisi** (31/08/2026), un blocco aggregato per ogni tipo di dato, così
il modello fa statistiche senza scaricare i record uno a uno: `guida_dati` (come
sono fatti i dati e quale strumento usare) · `statistiche_task` (totali, ritardi,
per tipo/stato/assegnatario, andamento mensile, tempo medio di chiusura) ·
`dettaglio_progetto` (membri, task, ore per persona e per mese, richieste) ·
`statistiche_richieste` (ticket per priorità, progetto, richiedente, tempi di
risoluzione) · `statistiche_ore` (ore per progetto/persona/mese/tipo di
attività/azienda, giornate e media) · `aziende` (peso di ogni cliente: offerte
aperte/vinte/perse coi valori, progetti, contatti). `stato_offerte` porta anche
la pipeline pesata, l'andamento mensile delle chiusure e le prime aziende. Gli
elenchi di task riportano `aperto_il`, `chiuso_il` e `ore`.

## Strumenti di record (05/09/2026)

Tutto ciò che si può **leggere** di una cosa sola, sempre nel perimetro
dell'utente: `dettaglio_task` (di qualunque tipo: campi, tre ruoli, tag,
azienda e referente, sottotask e sequenza, ore per persona, ricorrenza, dati
della richiesta, chat non riservata con i suoi allegati, allegati con id,
storico completo) · `allegati_task` · **`leggi_allegato`** (il testo estratto
di PDF, Word e file di testo e, con `formato: "file"`, il documento stesso:
immagini come immagine, il resto come risorsa, fino a 8 MB — il file lo
presta il core con la **sua** regola di accesso, `ctx.attachments`; fuori dal
core lo strumento lo dice; per un **collegamento** — Drive o altro — KeelOps ha
solo l'indirizzo e lo dice: si legge con il connettore dell'assistente verso quel
servizio, autorizzato con un account che abbia il permesso sul file) · `richieste` (ticket con priorità, riferimento,
richiedente e azienda, ultimo messaggio) · `messaggi` (la chat dei task in cui
l'utente ha un ruolo, o di un task, con ricerca nel testo) · `cerca_contatti`
e `dettaglio_azienda` (la rubrica: contatti, aziende, offerte, progetti, note
CRM, utenti del portale) · `persone` (chi è chi: ruolo, gruppi, progetti) ·
`mie_notifiche` · `ricorrenze` · `tag` (e `cerca_task` filtra per tag) ·
`mie_bacheche` (le card dell'estensione «Personale», se attiva). Gli allegati
sono anche **risorse** MCP: `keelops://allegato/<id>` via `resources/read`.

## Sicurezza, in breve

- OAuth 2.1: authorization code + PKCE S256 obbligatorio, refresh a rotazione,
  redirect_uri solo https (o localhost), codici monouso da 10 minuti.
- I token vivono 8 ore e si conservano come impronte sha256 in `data/oauth.json`:
  il file non contiene nulla di spendibile.
- `/mcp` senza token risponde 401 con `WWW-Authenticate` che punta ai metadati
  (RFC 9728), come da specifica MCP.
- Revoca: dalla pagina istruzioni («Connessioni attive» → Revoca, per il proprio
  utente), dal provider quando scolleghi il connettore (RFC 7009), o — colpo di
  spugna — cancellando `data/oauth.json`.

## Versione a pagamento (`gliner2_pii + mcp`): piano

Prodotto separato, non ancora costruito. Requisiti raccolti finora:

- **Pseudonimizzazione PII** dei testi in uscita con GLiNER2 **in ONNX dentro
  Node** (niente sidecar Python), con vocabolario di entità configurabile e
  mappa reversibile solo lato server.
- **Lettura dei documenti allegati** (richiesta del 24/08/2026, **fatta nella
  base il 05/09/2026** con `leggi_allegato`; qui resta il filtro PII da mettere
  davanti): prima `fetch` restituiva solo i campi di testo del record — un assistente non può leggere
  il preventivo allegato a un'offerta. La versione commerciale deve esporli:
  - estrazione del testo lato server (PDF, fogli, documenti; niente byte grezzi
    all'assistente) dal magazzino allegati, nel **perimetro dell'utente** e con
    un tetto di dimensione; i link Drive restano link (il core non custodisce
    token Drive, per scelta);
  - il testo estratto passa **prima** dal filtro PII, quando configurato;
  - esposizione via `fetch` sul record (allegati in coda al testo) o strumento
    dedicato `leggi_allegato`, da decidere misurando cosa i client usano meglio.

## Prova

```bash
node selftest.mjs /percorso/di/una/COPIA/del/db   # mai l'originale: crea sessioni finte
```

## Le edizioni (08/10/2026)

Su un core **community** non ci sono timesheet, richieste di supporto né
analisi delle offerte. Il connettore **nasconde** gli strumenti che ne
vivono (`ore_per_progetto`, `statistiche_ore`, `richieste`,
`statistiche_richieste`: si dichiarano con `richiede` in `lib/edizione.mjs`)
invece di rispondere vuoto — «hai lavorato 0 ore» sarebbe falso — e chiamati
per nome rispondono «non disponibile in questa edizione». Negli strumenti
misti spariscono i campi senza dati (`nata_da_ticket`, il blocco richiesta,
`utenti_portale`, `lettura_allegati`, `TICKET` fra i tipi, le ore aggregate di
`progetti` e `dettaglio_progetto`) e la guida ai dati si accorcia di conseguenza.
Le ore di base ci sono in tutte e due le edizioni (la griglia del timesheet è del
nucleo dall'08/10/2026): `mio_timesheet` e le ore di un task restano sempre.

Le funzioni arrivano da `ctx.funzioni` e viaggiano sull'utente
(`user.funzioni`): `buildTools(db, user, …)` non cambia firma, e MCP-pro —
che gira solo nella commerciale — vede tutto come prima. Senza `funzioni`
(modo autonomo, core di prima) vale tutto.
