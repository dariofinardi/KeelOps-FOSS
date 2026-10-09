import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors, { type FastifyCorsOptionsDelegateCallback } from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { forbidden } from "./lib/http-errors";
import rateLimit from "@fastify/rate-limit";
import { localeFromRequest, serverT } from "./i18n";
import fastifyStatic from "@fastify/static";
import { APP_VERSION } from "@kancrm/shared";
import { config } from "./config";
import { initSigningSecret } from "./lib/signing";
import { registerAuth } from "./plugins/auth";
import { registerPluginHost } from "./plugins/plugin-host";
import { registerMaintenanceGate } from "./modules/maintenance/gate";
import { maintenanceRoutes } from "./modules/maintenance/routes";
import { registerErrorHandler } from "./plugins/error-handler";
import { hostWithoutPort, shouldRedirectToHttps } from "./lib/https-redirect";
import { runWithRequestContext } from "./lib/request-context";
import { flushRecordChanges } from "./modules/realtime/record-changes";
import { authRoutes } from "./modules/auth/routes";
import { userRoutes } from "./modules/users/routes";
import { groupRoutes } from "./modules/groups/routes";
import { taskStatusRoutes } from "./modules/task-statuses/routes";
import { activityTypeRoutes } from "./modules/activity-types/routes";
import { taskRoutes } from "./modules/tasks/routes";
import { meetingRoutes } from "./modules/meetings/routes";
import { attachmentRoutes } from "./modules/attachments/routes";
import { richTextRoutes } from "./modules/rich-text/routes";
import { recurrenceRoutes } from "./modules/recurrence/routes";
import { dealStageRoutes } from "./modules/deal-stages/routes";
import { dealRoutes } from "./modules/deals/routes";
import { crmRoutes } from "./modules/crm/routes";
import { visibilityRoutes } from "./modules/visibility/routes";
import { projectRoutes } from "./modules/projects/routes";
import { hoursRoutes } from "./modules/hours/routes";
import { llmJobRoutes } from "./modules/jobs/routes";
import { devMetricsRoutes } from "./modules/dev-metrics/route";
import { notificationRoutes } from "./modules/notifications/routes";
import { registraElencoRotte } from "./edition/route-list";
import { moduliAttivi, politicheDei } from "./edition/registry";
import { impostaPoliticheRuoli } from "./edition/roles";
import { impostaRegoleAccessoTask } from "./modules/tasks/access-rules";
import { impostaAgganciTask } from "./modules/tasks/lifecycle-hooks";
import { themeRoutes } from "./modules/theme/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { searchRoutes } from "./modules/search/routes";
import { adminRoutes } from "./modules/admin/routes";
import { trashRoutes } from "./modules/trash/routes";
import { importRoutes } from "./modules/imports/routes";
import { calendarRoutes } from "./modules/calendar/routes";
import { pushRoutes } from "./modules/push/routes";
import { tagRoutes } from "./modules/tags/routes";
import { registerAnalytics } from "./modules/analytics/ga";

/**
 * Google Analytics, **solo nella demo** con GA configurato: lo script di gtag e
 * i domini a cui manda le misure. Altrove la politica dei contenuti resta
 * quella di sempre, senza un dominio in più.
 */
const GA_SCRIPT = ["https://www.googletagmanager.com"];

const GA_RETE = [
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
];

function loggerOptions(): FastifyServerOptions["logger"] {
  // Nei test niente logger: l'output di pino sommergeva i fallimenti reali.
  if (process.env.NODE_ENV === "test") return false;
  // Log persistenti con rotazione giornaliera (14 file) in produzione,
  // o forzabili in dev con LOG_TO_FILE=1. In dev: solo stdout.
  const fileLogging = !config.isDev || process.env.LOG_TO_FILE === "1";
  if (!fileLogging) return { level: "debug" };
  return {
    level: "info",
    transport: {
      targets: [
        {
          target: "pino-roll",
          options: {
            file: path.join(config.logDir, "app"),
            extension: ".log",
            frequency: "daily",
            mkdir: true,
            limit: { count: 14 },
          },
          level: "info",
        },
        { target: "pino/file", options: { destination: 1 }, level: "info" },
      ],
    },
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  /**
   * Il segreto che firma link e token, prima di rispondere a chiunque: se
   * cambiasse a ogni avvio, i "segna come fatto" già finiti nei calendari
   * smetterebbero di funzionare a ogni deploy (18/08/2026). Sta qui e non in
   * `index.ts` perché valga per ogni processo che serve richieste — e2e e test
   * compresi, che altrimenti proverebbero un comportamento diverso da quello
   * vero.
   */
  await initSigningSecret();

  const app = Fastify({
    logger: loggerOptions(),
    // Chiude anche keep-alive e stream SSE aperti durante lo shutdown.
    forceCloseConnections: true,
    /**
     * **Di chi fidarsi per l'indirizzo del chiamante.** Il TLS lo fa nginx
     * sulla stessa macchina, quindi ogni richiesta arriva da 127.0.0.1: senza
     * questa riga `request.ip` era sempre il proxy, e il rate limit del login
     * — che conta i tentativi per indirizzo — aveva **un secchio unico per
     * tutta l'utenza**: dieci password sbagliate di chiunque bloccavano il
     * login a tutti, e i log di sicurezza registravano solo nginx.
     *
     * `loopback` e non `true`: la porta HTTP del processo è raggiungibile
     * anche direttamente dalla rete interna, e con `true` chiunque potrebbe
     * scriversi un `X-Forwarded-For` di comodo — svuotando il rate limit e
     * sporcando i log. Così l'intestazione vale solo se a portarla è il
     * proxy locale; per chi arriva diretto resta l'indirizzo vero del peer.
     */
    trustProxy: "loopback",
  });
  registraElencoRotte(app);
  // I ruoli che i moduli dell'edizione portano (portale, monitor vendite):
  // prima di ogni rotta, il guardiano li legge a ogni richiesta.
  impostaPoliticheRuoli(politicheDei(moduliAttivi()));
  impostaRegoleAccessoTask(moduliAttivi().flatMap((m) => (m.accessoTask ? [m.accessoTask] : [])));
  impostaAgganciTask(moduliAttivi().flatMap((m) => (m.agganciTask ? [m.agganciTask] : [])));

  if (config.isDev) {
    /**
     * In sviluppo il frontend gira su Vite, quindi CORS acceso — ma **non** per
     * le rotte del modulo iniettabile, che le origini ammesse ce le ha sue, una
     * lista per chiave (`modules/inject/access.ts`).
     *
     * Senza questa eccezione il plugin rispondeva lui al preflight, con
     * `http://localhost:5173`, e il modulo in sviluppo non funzionava mai
     * mentre in produzione — dove il plugin non è nemmeno registrato — andava:
     * la stessa divergenza dev/prod che ha nascosto per settimane gli script
     * inline dei plugin. `preflightContinue` lascia passare la richiesta alla
     * nostra rotta, che sa quale chiave sta chiamando.
     */
    const delegato: FastifyCorsOptionsDelegateCallback = (request, callback) => {
      if (request.url.startsWith("/api/inject/") || request.url.startsWith("/inject/")) {
        callback(null, { origin: false, preflightContinue: true });
        return;
      }
      callback(null, { origin: "http://localhost:5173", credentials: true });
    };
    await app.register(cors, () => delegato);
  }

  // Security headers; CSP solo in produzione (in dev il frontend gira su Vite).
  const cspDeiModuli = (tipo: "script" | "img" | "connect" | "frame") =>
    moduliAttivi().flatMap((modulo) => modulo.csp?.[tipo] ?? []);
  await app.register(helmet, {
    contentSecurityPolicy: config.isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            // The modules' own sources (`csp` in the registry: the Drive picker
            // and Google Identity Services of the `google` module) come right
            // after 'self', as when they were written here.
            scriptSrc: [
              "'self'",
              ...cspDeiModuli("script"),
              ...(config.analytics ? GA_SCRIPT : []),
            ],
            // Il lettore PDF gira in un worker servito dalla nostra stessa
            // origine; pdf.js in alcuni percorsi lo avvia da un blob.
            workerSrc: ["'self'", "blob:"],
            styleSrc: ["'self'", "'unsafe-inline'"], // stili inline (colori dinamici)
            // Il selettore Drive disegna anteprime e icone dai domini Google.
            imgSrc: [
              "'self'",
              "data:",
              ...cspDeiModuli("img"),
              ...(config.analytics ? GA_RETE : []),
            ],
            connectSrc: [
              "'self'",
              ...cspDeiModuli("connect"),
              ...(config.analytics ? GA_RETE : []),
            ],
            // Il Picker e il consenso Google girano in un iframe; 'self' è
            // per le pagine dei plugin, incorniciate dentro AppShell.
            frameSrc: ["'self'", ...cspDeiModuli("frame")],
          },
        },
    strictTransportSecurity: config.isDev ? false : undefined,
    crossOriginEmbedderPolicy: false,
    // Il default di helmet (`same-origin`) taglia il canale tra la pagina e i
    // popup: il consenso Drive di Google Identity Services si chiudeva senza
    // poter riferire il token, e il selettore non compariva mai — senza un
    // errore che fosse uno (10/08/2026). `same-origin-allow-popups` è il valore
    // che Google prescrive per i flussi a popup.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // Altro default di helmet che rompe Google (`no-referrer`): una chiave API
    // ristretta per sito viene rifiutata ("chiave sviluppatore non valida") se
    // la richiesta arriva senza referrer, perché Google non ha nulla da
    // confrontare con la restrizione. Il valore qui è il default dei browser:
    // fuori origine viaggia solo l'origine, mai il percorso.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  // Rate limiting per-route (usato dal login, vedi modules/auth/routes.ts).
  await app.register(rateLimit, {
    global: false,
    /**
     * L'attesa la dice la libreria, in inglese: «riprova tra 11 minutes» è una
     * frase mezza tradotta che si legge nella pagina di accesso, cioè il primo
     * posto in cui qualcuno arriva (03/09/2026). Il tempo lo si ricava dal `ttl`
     * — millisecondi — e la frase esce nella lingua di chi legge.
     */
    errorResponseBuilder: (request, context) => {
      const locale = localeFromRequest(request);
      const minuti = Math.max(1, Math.ceil(context.ttl / 60_000));
      return {
        statusCode: 429,
        error: "RATE_LIMITED",
        message: serverT(locale, "Troppi tentativi: riprova fra {{count}} minuti", {
          count: minuti,
        }),
      };
    },
  });

  registerErrorHandler(app);

  // Chi apre l'indirizzo in chiaro finisce sul sito sicuro. Il processo resta in
  // HTTP perché il TLS lo fa nginx davanti: le richieste che arrivano dal proxy
  // (X-Forwarded-Proto: https) e quelle locali — health check del deploy incluso —
  // non vanno toccate, o si creerebbe un rimbalzo infinito.
  if (config.httpsRedirectPort > 0) {
    app.addHook("onRequest", (request, reply, done) => {
      if (shouldRedirectToHttps(request.headers, request.ip)) {
        const host = hostWithoutPort(request.headers.host);
        // 308: preserva metodo e corpo, così anche una POST arrivata per sbaglio
        // in chiaro non si trasforma in GET.
        void reply.redirect(`https://${host}:${config.httpsRedirectPort}${request.url}`, 308);
        return;
      }
      done();
    });
  }

  // Contesto per-richiesta (memoizzazione query): registrato per primo così
  // avvolge il guard di auth e l'handler. Vedi lib/request-context.
  app.addHook("onRequest", (_request, _reply, done) => {
    runWithRequestContext(done);
  });

  /*
    Avvisi "questo record è cambiato": si spediscono qui, a risposta conclusa.
    Prima non si può — dentro la transazione il commit non c'è ancora — e solo
    se la richiesta è andata a buon fine: su un errore non è cambiato niente.
  */
  app.addHook("onResponse", (_request, reply, done) => {
    if (reply.statusCode < 400) void flushRecordChanges();
    done();
  });

  await registerAuth(app);

  // Il cancello della manutenzione: dopo l'auth (usa il ruolo vero), prima dei
  // plugin e delle rotte, così chiude tutto tranne chi può riaprire.
  registerMaintenanceGate(app);

  /**
   * I plugin side-loaded (`PLUGINS=mappa,mcp`): montati su /plugins/<nome>/
   * col dispatcher condiviso, l'autenticazione vera del core e il database in
   * sola lettura. Prima dell'auth delle rotte applicative non serve stare:
   * le rotte dei plugin fanno da sé il riconoscimento dell'utente.
   */
  await registerPluginHost(app);
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  });

  /**
   * **In dimostrazione non si caricano file.** Una vetrina aperta a chiunque,
   * con il trascinamento attivo, è uno spazio di archiviazione gratuito per il
   * primo che passa — e quello che ci finisce dentro risponde dal nostro
   * indirizzo.
   *
   * Il rifiuto sta **qui**, su tutto ciò che arriva come `multipart`, e non
   * una guardia per rotta: le vie per mandare un file sono gli allegati, la
   * foto del profilo, il logo, le importazioni e le ricorrenze, e la prossima
   * che qualcuno scriverà sarebbe aperta senza che un test lo dica. Nascondere
   * i riquadri di trascinamento nella pagina non basta: è l'ultima cosa da
   * fare, non la prima.
   */
  // Google Analytics degli endpoint: solo nella demo, e solo con il segreto.
  registerAnalytics(app);

  if (config.demo) {
    app.addHook("onRequest", async (request) => {
      const tipo = String(request.headers["content-type"] ?? "");
      if (request.method !== "GET" && tipo.includes("multipart/form-data")) {
        throw forbidden("Nella dimostrazione non si caricano file.");
      }
    });
  }

  // Anche la versione: è il modo più diretto per sapere cosa gira davvero in
  // produzione, senza entrare sul server a leggere un package.json.
  app.get("/api/health", { config: { public: true } }, async () => ({
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  }));

  authRoutes(app);
  maintenanceRoutes(app);
  userRoutes(app);
  groupRoutes(app);
  taskStatusRoutes(app);
  activityTypeRoutes(app);
  taskRoutes(app);
  meetingRoutes(app);
  attachmentRoutes(app);
  richTextRoutes(app);
  recurrenceRoutes(app);
  dealStageRoutes(app);
  dealRoutes(app);
  crmRoutes(app);
  visibilityRoutes(app);
  projectRoutes(app);
  // The timesheet grid is core; its commercial extras come with the timesheet module.
  hoursRoutes(app);
  // The AI queue panel is core (08/10/2026): the jobs that fill it may be commercial.
  llmJobRoutes(app);
  // «L'andamento», the dev manager's panel: core since 08/10/2026.
  devMetricsRoutes(app);
  notificationRoutes(app);
  themeRoutes(app);
  dashboardRoutes(app);
  searchRoutes(app);
  adminRoutes(app);
  trashRoutes(app);
  importRoutes(app);
  calendarRoutes(app);
  pushRoutes(app);
  tagRoutes(app);
  // I moduli dell'edizione (ticket, timesheet, integrazioni…): nella community nessuno.
  for (const modulo of moduliAttivi()) modulo.rotte?.(app);

  /**
   * **Niente di questa applicazione va nei motori di ricerca.**
   *
   * Il 09/09/2026 la schermata di accesso della produzione è comparsa su
   * Google, al posto del sito del prodotto: un gestionale aziendale non ha
   * niente da dire a chi cerca, e comparire vuol dire dare a chiunque
   * l'indirizzo da cui si prova a entrare.
   *
   * L'intestazione sta **su ogni risposta** e non solo sull'HTML: le API
   * rispondono JSON, e un JSON indicizzato è comunque un indirizzo pubblicato.
   * `onSend` è il punto in cui passano tutte, comprese quelle dei plugin e gli
   * errori — una guardia per rotta avrebbe dimenticato la prossima.
   *
   * **Perché il `robots.txt` non basta, ed è la parte che sorprende**: un
   * motore a cui si vieta la scansione non può nemmeno *leggere* il divieto di
   * indicizzare, e un indirizzo già finito nei risultati ci resta. Per toglierlo
   * bisogna lasciarlo entrare e fargli leggere questo `noindex`. Vedi
   * `/robots.txt` più sotto.
   */
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Robots-Tag", "noindex, nofollow");
  });

  /**
   * Servito dall'applicazione e non da nginx, così ogni installazione ce l'ha
   * senza che nessuno debba ricordarsene: la produzione, la dimostrazione, e
   * quella di un cliente domani.
   */
  app.get("/robots.txt", { config: { public: true } }, async (_request, reply) => {
    reply.type("text/plain; charset=utf-8");
    return `# KeelOps — applicazione gestionale privata.
#
# Non deve comparire in nessun motore di ricerca. A dirlo e' l'intestazione
# "X-Robots-Tag: noindex, nofollow" su OGNI risposta, non questo file.
#
# La scansione qui e' PERMESSA di proposito: un motore che non puo' leggere la
# pagina non puo' leggere nemmeno il "noindex", e un indirizzo gia' finito nei
# risultati ci resterebbe per sempre. Vietare la scansione congela
# l'indicizzazione, non la toglie.
#
# Il sito del prodotto, quello si', va indicizzato: https://keelops.it
User-agent: *
Disallow:
`;
  });

  // In produzione Fastify serve anche la build statica del frontend (vedi CLAUDE.md).
  const publicDir = path.resolve(import.meta.dirname, "../public");
  const serveSpa = existsSync(publicDir);
  if (serveSpa) {
    /**
     * **Due politiche di cache, non una.**
     *
     * Prima tutto usciva con `public, max-age=0`, che è la combinazione
     * peggiore delle due possibili: i file con l'impronta nel nome — che per
     * costruzione non cambiano mai — venivano richiesti a ogni apertura, e
     * l'`index.html`, che invece cambia a ogni rilascio, poteva essere riusato
     * dalla cache. Una scheda ripescava l'HTML vecchio, che nomina file
     * spariti, e quella pagina restava a metà: il foglio di stile tornava un
     * 404 in JSON ("Refused to apply style… MIME type application/json"), il
     * codice vecchio chiamava rotte cambiate, e nella console arrivavano tre
     * errori diversi con una causa sola (20/08/2026).
     *
     * Quindi: l'**index** non si tiene mai (`no-cache`: si può conservare, ma
     * va richiesto ogni volta), gli **asset con impronta** si tengono un anno
     * e `immutable` — cambiando contenuto cambia il nome, quindi non c'è
     * niente da rivalidare.
     */
    await app.register(fastifyStatic, {
      root: publicDir,
      // Attenzione alla versione: fino alla 8 `setHeaders` riceveva la
      // risposta grezza di Node (`reply.raw`, quindi `setHeader`); dalla 10 —
      // l'aggiornamento del 19/08/2026 — riceve la reply di Fastify, che si
      // scrive con `header`.
      setHeaders(reply, percorso) {
        const impronta = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(percorso);
        reply.header(
          "Cache-Control",
          impronta ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (serveSpa && request.method === "GET" && !request.url.startsWith("/api/")) {
      // Un file della build che non c'è più (pagina aperta da prima di un
      // rilascio, che chiede chunk della versione vecchia) deve rispondere 404,
      // non l'index: servire HTML dove il browser aspetta JavaScript dà un
      // errore di MIME che non dice niente, e la pagina resta rotta finché non
      // la si ricarica a mano. Con il 404 il client se ne accorge e ricarica.
      if (request.url.startsWith("/assets/")) {
        return reply.status(404).send({
          error: "STALE_ASSET",
          message: "File della build non presente: ricarica la pagina",
        });
      }
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({
      error: "NOT_FOUND",
      message: `Risorsa non trovata: ${request.method} ${request.url}`,
    });
  });

  return app;
}
