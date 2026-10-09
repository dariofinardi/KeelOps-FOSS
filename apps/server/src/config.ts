import path from "node:path";
import { z } from "zod";

const rootDir = path.resolve(import.meta.dirname, "../../..");

/**
 * `DEMO_ACCOUNTS` → l'elenco da stampare sulla pagina di accesso.
 * Formato: `email:Ruolo` separati da virgola. Una voce senza `:` si scarta
 * invece di comparire mezza vuota, e senza password non si mostra niente:
 * un elenco di indirizzi senza la chiave per entrarci è solo un invito a
 * provarci.
 */
export function leggiConfigDemo(
  attiva: boolean,
  elenco: string,
  password: string,
): { password: string; accounts: { email: string; role: string }[] } | null {
  return attiva ? leggiDemo(elenco, password) : null;
}

/**
 * Google Analytics: `null` se l'installazione non è una demo, anche con
 * l'identificativo scritto — la regola sta qui, una volta sola, e i test la
 * provano soprattutto nel verso della produzione.
 */
export function leggiConfigAnalytics(
  demo: boolean,
  measurementId: string,
  apiSecret: string,
): { measurementId: string; apiSecret: string | null } | null {
  return demo && measurementId ? { measurementId, apiSecret: apiSecret || null } : null;
}

function leggiDemo(
  elenco: string,
  password: string,
): { password: string; accounts: { email: string; role: string }[] } {
  const accounts = elenco
    .split(",")
    .map((voce) => voce.trim())
    .filter(Boolean)
    .map((voce) => {
      const taglio = voce.indexOf(":");
      if (taglio < 1) return null;
      return { email: voce.slice(0, taglio).trim(), role: voce.slice(taglio + 1).trim() };
    })
    .filter((v): v is { email: string; role: string } => v !== null && v.email.includes("@"));
  // Le credenziali sono facoltative: si può volere una demo che blocca i
  // caricamenti senza pubblicare nessun accesso. Senza password non si stampa
  // niente — un elenco di indirizzi senza la chiave è solo un invito a provarci.
  return { password, accounts: password ? accounts : [] };
}

/**
 * Variabili d'ambiente numeriche, validate all'avvio: un refuso in `.env`
 * (es. `BACKUP_RETENTION_DAYS=trenta`) deve fermare il boot con un messaggio
 * chiaro, non produrre `NaN` a runtime (retention NaN = nessun purge, silenzioso).
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Whose `X-Forwarded-For` to believe (Fastify `trustProxy`): `loopback` — the
   * proxy on the same machine, as in every installation behind nginx. In Docker
   * the proxy is another container: `loopback,uniquelocal` trusts the private
   * networks too (the application port must then not be published).
   */
  TRUST_PROXY: z.string().default("loopback"),
  /**
   * I plugin da caricare DENTRO il processo del core (side-loaded) ed erogare
   * come `/plugins/<nome>/…`: un elenco di nomi, es. `TasksMap,mcp`
   * (le cartelle corrispondenti sotto `plugins/`).
   * Vuoto = nessun plugin: il core non sa che esistono.
   */
  PLUGINS: z.string().default(""),
  /** Dove stanno le cartelle dei plugin (default: `plugins/` nella radice). */
  PLUGINS_DIR: z.string().default(""),
  /**
   * **Solo per un ambiente di dimostrazione.** Le credenziali di prova da
   * stampare sulla pagina di accesso, perché chi arriva entri senza doverle
   * chiedere a nessuno. Una coppia per voce, separate da virgola:
   *
   *     DEMO_ACCOUNTS=admin@x.demo:Amministratore,sales@x.demo:Commerciale
   *     DEMO_PASSWORD=…
   *
   * Vuote in produzione, e **devono restarci**: il valore non è un segreto —
   * è pubblicato apposta — ma sta nel `.env` di quell'installazione e non nel
   * codice, così nessuno lo porta dove non deve stare.
   */
  DEMO_ACCOUNTS: z.string().default(""),
  DEMO_PASSWORD: z.string().default(""),
  /**
   * **Modalità dimostrazione.** Accendendola questa installazione dichiara di
   * essere una vetrina: stampa le credenziali di prova sulla pagina di accesso
   * e **rifiuta i caricamenti di file**. Non è una comodità: una demo aperta a
   * chiunque, con il trascinamento dei file attivo, è uno spazio di
   * archiviazione gratuito per il primo che passa, e quello che ci finisce
   * dentro risponde dal nostro indirizzo.
   */
  /**
   * **L'edizione** (08/10/2026): `commerciale` carica anche i moduli commerciali
   * (ticket e portale, timesheet e assenze, integrazioni, modulo iniettabile,
   * area investitori, indice dei modelli); `community` solo il nucleo. Il
   * database è lo stesso nelle due: vedi plan/edizioni.md. Predefinita
   * `commerciale`, cioè KeelOps come è sempre stato.
   */
  KEELOPS_EDITION: z.enum(["community", "commerciale"]).default("commerciale"),
  DEMO: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .default(false),
  /**
   * **Google Analytics, solo nella demo** (18/09/2026): quali funzioni si
   * aprono e quali endpoint si chiamano, per capire cosa guarda chi prova il
   * prodotto. L'identificativo GA4 (`G-…`) va alla pagina; il segreto del
   * Measurement Protocol resta sul server, che manda gli eventi degli
   * endpoint. **Senza `DEMO=true` non si accende niente**, anche con le due
   * righe scritte: in produzione non si traccia nessuno.
   */
  GA_MEASUREMENT_ID: z
    .string()
    .trim()
    .regex(/^(G-[A-Z0-9]+)?$/, "GA_MEASUREMENT_ID è un identificativo GA4: G-XXXXXXXXXX")
    .default(""),
  GA_API_SECRET: z.string().trim().default(""),
  /**
   * Porta HTTPS verso cui mandare chi arriva in chiaro (0 = nessun redirect).
   * In produzione il TLS lo fa nginx sulla 5443 e il processo resta in HTTP
   * dietro al proxy: chi apre l'indirizzo con la porta del backend deve finire
   * comunque sul sito sicuro, non su una pagina che non funziona.
   */
  HTTPS_REDIRECT_PORT: z.coerce.number().int().min(0).default(5443),
  /**
   * Dimensione massima di un allegato. Chi la alza deve alzare **anche**
   * `client_max_body_size` in nginx (che sta davanti al servizio): il proxy
   * rifiuta prima, con un 413 che non passa nemmeno dall'applicazione, e il
   * messaggio che l'utente legge non spiega niente.
   */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(80),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * **Per quanto una richiesta resta in carico a chi l'ha aperta.**
   *
   * Due persone che rispondono allo stesso ticket nello stesso momento
   * scrivono due risposte sovrapposte, e il cliente ne legge due. Chi apre il
   * pannello se lo prende in carico per questo tempo; scaduto, torna libero per
   * tutti — non si rinnova da sé, o basterebbe lasciare una scheda aperta per
   * tenerlo occupato tutto il giorno.
   */
  TICKET_LOCK_MINUTES: z.coerce.number().int().positive().default(10),
  /**
   * Ogni quanto parte il riepilogo, per chi ha chiesto le email aggregate.
   * Sta dentro l'ora perché diventa un cron ogni-n-minuti: oltre i 59 quella
   * espressione non vorrebbe più dire niente, e il servizio non partirebbe.
   */
  EMAIL_DIGEST_MINUTES: z.coerce.number().int().min(1).max(59).default(15),
  /**
   * Quanto aspetta l'email di un avviso prima di partire (25/09/2026). Se in
   * questo tempo l'avviso si legge nella campanella, l'email non parte: chi l'ha
   * già visto lavorando non deve ritrovarselo in posta. 0 = subito.
   */
  EMAIL_GRACE_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),

  // --- Dove vivono gli allegati (vedi modules/attachments/store.ts).
  //
  // **Configurato = acceso**, come la posta: senza `ATTACHMENT=GCP` i file
  // restano sul disco, che è il comportamento di sempre. Le credenziali di
  // Google NON stanno qui: si usano le Application Default Credentials della
  // macchina (service account o `GOOGLE_APPLICATION_CREDENTIALS`), perché una
  // chiave privata nel `.env` finisce prima o poi in un backup o in un log.
  ATTACHMENT: z.enum(["LOCAL", "GCP"]).default("LOCAL"),
  /** Bucket e sottocartella: `gs://keelops` oppure `gs://keelops/prod`. */
  ATTACHMENT_URI: z.string().default(""),
  ATTACHMENT_GCP_PROJECT: z.string().default(""),
  /**
   * Dove stavano i file **prima** di un trasloco nel bucket (02/10/2026), per
   * esempio `gs://keelops` quando l'istanza passa a `gs://keelops/istanze/jugaad`.
   * Finché c'è, un file che nel posto nuovo non si trova si cerca qui: il
   * servizio resta acceso mentre `scripts/sposta-cartella-bucket.ts` sposta i
   * file. Finito il trasloco si toglie (o resta, e non trova più niente).
   */
  ATTACHMENT_URI_PRECEDENTE: z.string().default(""),
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // --- Modelli locali (vedi modules/insights/ollama.ts).
  //
  // **Configurato = acceso**, come la posta: se c'è un indirizzo e un modello,
  // la somiglianza tra task usa gli embedding; altrimenti si calcola sulle
  // parole e tutto funziona lo stesso. L'indirizzo è separato proprio per poter
  // puntare all'istanza legata a una scheda precisa (es. la 3090 sulla 11435).
  OLLAMA_URL: z.string().default(""),
  OLLAMA_EMBED_MODEL: z.string().default(""),
  /**
   * Modello che **normalizza** i task (titoli, descrizioni e chat sono
   * eterogenei: due lingue, collegamenti al posto delle descrizioni, saluti).
   * Costa qualche secondo per task, quindi gira di notte e mai mentre qualcuno
   * aspetta. Vuoto = si indicizza il testo grezzo.
   */
  OLLAMA_TEXT_MODEL: z.string().default(""),
  /**
   * Il ragionamento del modello, acceso o spento. **Spento per difetto**: i
   * modelli pensanti (qwen3.8 e parenti) consumano nel ragionamento il tetto di
   * token che serve alla risposta, e con uno schema JSON la risposta arriva
   * troncata — cioè inutilizzabile. Acceso può servire un giorno, con un
   * modello che ragiona bene e un tetto largo: è per questo che è una variabile
   * e non una costante.
   */
  /**
   * Indirizzo **segreto** in formato iCal del calendario delle assenze (Google
   * Calendar → Impostazioni → Indirizzo privato). Sta qui e non in banca dati
   * perché è una credenziale: chi ce l'ha legge il calendario. Vuoto = nessun
   * calendario, e le assenze restano dedotte come prima.
   */
  /**
   * Dove sta `etc/config.json` (calendario delle assenze e alias delle
   * persone). Vuoto = la convenzione: `etc/config.json` nella radice.
   */
  CONFIG_FILE: z.string().default(""),
  /**
   * Indirizzo del calendario delle assenze. **Il file vince**: questa resta per
   * chi preferisce tenerlo nell'ambiente, e per non rompere chi già l'aveva.
   */
  /**
   * **Il micromodello che legge le righe di calendario che le regole non
   * spiegano.** Configurato = acceso, come la posta e i modelli grandi: senza
   * un nome qui non viene interrogato nessuno, e vale il solo vocabolario di
   * `etc/config.json`. Acceso, vede soltanto quello che le parole hanno
   * lasciato cadere e non può contraddirle.
   *
   * Gira sempre in CPU (vedi `timesheet/absences-model.ts`), quindi l'indirizzo
   * giusto è l'istanza di sistema e **non** `OLLAMA_URL`, che qui punta a
   * quella legata alla 3090 — la quale ha un suo store di modelli e questo non
   * ce l'ha. Vuoto ripiega su `OLLAMA_URL`, che è comodo in sviluppo dove
   * l'istanza è una sola.
   */
  ABSENCE_MODEL: z.string().default(""),
  ABSENCE_MODEL_URL: z.string().default(""),
  ABSENCE_CALENDAR_URL: z.string().default(""),
  OLLAMA_THINKING_QWEN: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
    .default(false),
  /** Quanti task normalizzare per giro notturno: il primo pieno dura più notti. */
  OLLAMA_NORMALIZE_PER_RUN: z.coerce.number().int().min(0).default(300),

  // --- Posta in uscita (vedi modules/mail).
  //
  // **Configurata = accesa**: se c'è un server a cui consegnare (MAILER_HOST) si
  // spedisce, altrimenti si scrive soltanto nel log cosa sarebbe partito. Niente
  // interruttore separato: un "acceso ma non configurato" (o il contrario) è uno
  // stato che serve solo a far domandare perché le email non arrivano.
  MAILER_HOST: z.string().default(""),
  MAILER_PORT: z.coerce.number().int().positive().default(587),
  /** true solo con la 465 (TLS diretto); sulla 587 si sale con STARTTLS. */
  MAILER_USE_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MAILER_USERNAME: z.string().default(""),
  MAILER_PASSWORD: z.string().default(""),
  MAILER_FROM: z.string().default("KeelOps <no-reply@localhost>"),
  /**
   * Indirizzo pubblico dell'applicazione: serve a costruire i link dentro le
   * email. Senza, l'email arriva **senza collegamento** invece che con uno che
   * porta al localhost del server — un link rotto è peggio della sua assenza.
   */
  APP_BASE_URL: z.string().default(""),

  /**
   * File che contiene il "pepe" delle password: un segreto fuori dal database,
   * senza il quale gli hash non si verificano. Vuoto = non attivo (gli hash
   * restano comunque argon2id con sale casuale). Vedi modules/auth/password.
   */
  PASSWORD_PEPPER_FILE: z.string().default(""),

  // --- SSO Google (vedi modules/auth/google.ts).
  //
  // **Configurato = acceso**, come la posta: se c'è un CLIENT_ID il pulsante
  // "Accedi con Google" compare e le rotte OAuth rispondono; senza, restano spente.
  // Il login locale resta sempre come fallback (soprattutto per l'admin).
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /**
   * Domini Workspace ammessi al SSO (CSV, es. "example.com,example.org"). Il
   * controllo è server-side sul token verificato: il parametro `hd` mandato a
   * Google è solo un suggerimento per la schermata di scelta account.
   */
  GOOGLE_ALLOWED_DOMAINS: z.string().default(""),
  /**
   * Selettore Google Drive (lato browser). Sono valori pubblici, da limitare per
   * referrer sulla console Google: API key del browser e numero del progetto Cloud.
   * Il token Drive è effimero e non passa mai dal server (vedi useGoogleDrivePicker).
   */
  GOOGLE_API_KEY: z.string().default(""),
  GOOGLE_APP_ID: z.string().default(""),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Configurazione non valida — variabili d'ambiente:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  port: env.PORT,
  pluginsSpec: env.PLUGINS,
  pluginsDir: env.PLUGINS_DIR || path.join(rootDir, "plugins"),
  /**
   * La dimostrazione: `null` ovunque non sia una demo. Chi la legge non deve
   * chiedersi anche se le credenziali ci sono — l'oggetto esiste se e solo se
   * questa installazione è una vetrina.
   */
  edizione: env.KEELOPS_EDITION,
  demo: leggiConfigDemo(env.DEMO, env.DEMO_ACCOUNTS, env.DEMO_PASSWORD),
  /**
   * Google Analytics: esiste solo in una demo con l'identificativo scritto.
   * Il segreto (`apiSecret`) non esce dal server: la pagina riceve solo
   * `measurementId`, via `/api/auth/providers`. Senza segreto la pagina conta
   * le funzioni e il server non manda gli endpoint.
   */
  analytics: leggiConfigAnalytics(env.DEMO, env.GA_MEASUREMENT_ID, env.GA_API_SECRET),
  isDev: process.env.NODE_ENV !== "production",
  trustProxy: env.TRUST_PROXY,
  // Redirect verso HTTPS: attivo solo in produzione (in sviluppo non c'è TLS e
  // manderebbe il browser su una porta che non risponde). HTTPS_REDIRECT_PORT=0
  // lo disattiva anche lì.
  httpsRedirectPort: process.env.NODE_ENV === "production" ? env.HTTPS_REDIRECT_PORT : 0,
  // Unica timezone aziendale (vedi CLAUDE.md): le date in DB restano UTC.
  displayTimezone: "Europe/Rome",
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(rootDir, "data", "uploads"),
  attachments: {
    backend: env.ATTACHMENT,
    uri: env.ATTACHMENT_URI,
    gcpProject: env.ATTACHMENT_GCP_PROJECT,
    previousUri: env.ATTACHMENT_URI_PRECEDENTE,
  },
  maxUploadMb: env.MAX_UPLOAD_MB,
  ticketLockMinutes: env.TICKET_LOCK_MINUTES,
  emailDigestMinutes: env.EMAIL_DIGEST_MINUTES,
  emailGraceMinutes: env.EMAIL_GRACE_MINUTES,
  ollamaUrl: env.OLLAMA_URL,
  ollamaEmbedModel: env.OLLAMA_EMBED_MODEL,
  ollamaTextModel: env.OLLAMA_TEXT_MODEL,
  ollamaThinking: env.OLLAMA_THINKING_QWEN,
  absenceCalendarUrl: env.ABSENCE_CALENDAR_URL,
  absenceModel: env.ABSENCE_MODEL,
  absenceModelUrl: env.ABSENCE_MODEL_URL,
  configFile: env.CONFIG_FILE,
  rootDir,
  ollamaNormalizePerRun: env.OLLAMA_NORMALIZE_PER_RUN,
  backupsDir: process.env.BACKUPS_DIR ?? path.join(rootDir, "data", "backups"),
  backupRetentionDays: env.BACKUP_RETENTION_DAYS,
  trashRetentionDays: env.TRASH_RETENTION_DAYS,
  logDir: process.env.LOG_DIR ?? path.join(rootDir, "data", "logs"),
  /**
   * Quello che il micromodello delle assenze ha già capito, una riga per
   * titolo. È una comodità che si può rifare, non un dato: sta in un file di
   * testo accanto agli altri, non dentro il database (vedi
   * `timesheet/absences-model.ts`).
   */
  absenceMemoryFile:
    process.env.ABSENCE_MEMORY_FILE ?? path.join(rootDir, "data", "assenze-modello.jsonl"),
  /**
   * Il registro delle impronte del calendario: com'era all'ultima scansione,
   * per dire la notte dopo cosa è stato inserito, modificato o cancellato
   * (vedi `timesheet/absences-registry.ts`). Vive accanto alla memoria del
   * modello e come lei entra nel backup serale.
   */
  absenceRegistryFile:
    process.env.ABSENCE_REGISTRY_FILE ?? path.join(rootDir, "data", "assenze-calendario.json"),
  /**
   * File lasciato dal deploy accanto all'applicazione: hash del commit,
   * versione e data. È l'unico modo che il processo in esecuzione ha di sapere
   * **quale codice** sta girando — la copia in produzione non ha un `.git` da
   * interrogare — e finisce nel nome delle istantanee notturne del database,
   * perché al ripristino la domanda è "questo file con quale codice ci va?".
   */
  deployedCommitFile:
    process.env.DEPLOYED_COMMIT_FILE ?? path.join(rootDir, "..", "DEPLOYED_COMMIT"),
  /**
   * Firma i token di download e i link "segna come fatto" del calendario. Se
   * l'ambiente non lo dice resta **vuoto** e `lib/signing.ts` ne conserva uno
   * in banca dati: generarne uno casuale a ogni avvio spegneva in silenzio
   * tutti i link già finiti nei calendari (18/08/2026).
   */
  downloadTokenSecret: process.env.DOWNLOAD_TOKEN_SECRET ?? "",
  /**
   * Chiave dei messaggi riservati (@secret nella chat): i corpi si cifrano
   * con AES-256-GCM e la chiave si deriva da qui (SHA-256). Vuota = la
   * funzione è spenta e @secret viene rifiutato con un errore chiaro.
   * Cambiare la chiave rende illeggibili i messaggi già cifrati: non ruotarla
   * senza un piano di ricodifica.
   */
  secretKeyCrypto: process.env.SECRET_KEY_CRYPTO ?? "",
  passwordPepperFile: env.PASSWORD_PEPPER_FILE,
  /**
   * Indirizzo pubblico dell'applicazione — unica verità per i link assoluti
   * (email, calendari) e per il redirect OAuth. Stessa fonte di `mail.baseUrl`.
   */
  publicUrl: env.APP_BASE_URL,
  /**
   * SSO Google e selettore Drive. `enabled` segue il pattern "configurato =
   * acceso": il pulsante e le rotte esistono solo se c'è un CLIENT_ID. Il
   * dominio è ristretto server-side sul token verificato.
   */
  oauth: {
    google: {
      enabled: env.GOOGLE_CLIENT_ID !== "",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      allowedDomains: env.GOOGLE_ALLOWED_DOMAINS.split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
      redirectUri: `${env.APP_BASE_URL}/api/auth/google/callback`,
      // Picker lato browser: acceso solo se ci sono anche API key e appId.
      picker: {
        enabled:
          env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_API_KEY !== "" && env.GOOGLE_APP_ID !== "",
        apiKey: env.GOOGLE_API_KEY,
        appId: env.GOOGLE_APP_ID,
      },
    },
  },
  /**
   * Posta in uscita. Con SendGrid: MAILER_HOST=smtp.sendgrid.net, MAILER_PORT=587,
   * MAILER_USERNAME=apikey, MAILER_PASSWORD=<chiave API>, MAILER_USE_TLS=false
   * (la 587 usa STARTTLS). Il mittente dev'essere verificato sul provider.
   */
  mail: {
    enabled: env.MAILER_HOST !== "",
    transport: env.MAILER_HOST !== "" ? ("smtp" as const) : ("log" as const),
    from: env.MAILER_FROM,
    baseUrl: env.APP_BASE_URL,
    appName: "KeelOps",
    smtp: {
      host: env.MAILER_HOST,
      port: env.MAILER_PORT,
      secure: env.MAILER_USE_TLS,
      user: env.MAILER_USERNAME,
      password: env.MAILER_PASSWORD,
    },
  },
} as const;
