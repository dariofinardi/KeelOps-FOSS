import type { FastifyInstance, FastifyRequest } from "fastify";
import { CONSENSO_COOKIE, leggiSceltaCookie } from "@kancrm/shared";
import { config } from "../../config";

/**
 * **Gli endpoint della demo in Google Analytics** (18/09/2026).
 *
 * La pagina conta le funzioni che si aprono (gtag, nel browser); qui il server
 * conta gli **endpoint chiamati**, con il Measurement Protocol di GA4: quale
 * rotta (il modello, `/api/tasks/:id`, mai l'indirizzo con dentro gli id),
 * con che metodo, con che esito e in quanto tempo. Così nello stesso rapporto
 * si legge «ha aperto le offerte» e «ha salvato un'offerta, e ha avuto un 403».
 *
 * Tre condizioni, tutte necessarie:
 * - è una **demo** con GA configurato (`config.analytics`, null altrove: in
 *   produzione questo modulo non registra nemmeno l'hook);
 * - chi chiama ha **acconsentito alle statistiche**: il cookie della scelta
 *   condiviso con il sito keelops.it (`keelops_cookie`, vedi
 *   `consenso-cookie.ts`), lo stesso che fa caricare gtag nella pagina, e
 *   sulla versione in vigore dell'informativa;
 * - ha il cookie `_ga` di Google: è lui che lega gli eventi del server alla
 *   visita del browser. Senza, non c'è una visita a cui attaccarli.
 *
 * Non parte nessun dato personale: niente email, niente id di record, niente
 * indirizzo IP del visitatore (la richiesta verso Google la fa il server). Il
 * ruolo di chi chiama (ADMIN, MEMBER…) sì: è ciò che distingue i percorsi.
 */

/** Le rotte che non dicono niente su cosa si guarda: il canale aperto e il battito. */
const ESCLUSE = new Set(["/api/notifications/stream", "/api/health"]);

/** `GA1.1.1234567890.1726650000` → `1234567890.1726650000`: il client_id di GA4. */
export function clientIdDaCookie(valore: string | undefined): string | null {
  const m = /^GA\d\.\d\.(\d+\.\d+)$/.exec(valore ?? "");
  return m ? m[1]! : null;
}

/**
 * La sessione dal cookie `_ga_<contenitore>`, nelle due forme che gtag scrive:
 * `GS1.1.1726650000.3.1.…` e la più recente `GS2.1.s1726650000$o3$g1…`.
 */
export function sessionIdDaCookie(valore: string | undefined): string | null {
  if (!valore) return null;
  const vecchia = /^GS1\.\d\.(\d+)\./.exec(valore);
  if (vecchia) return vecchia[1]!;
  const nuova = /^GS2\.\d\.s(\d+)/.exec(valore);
  return nuova ? nuova[1]! : null;
}

export interface EventoEndpoint {
  name: "api_request";
  params: {
    endpoint: string;
    method: string;
    status_code: number;
    duration_ms: number;
    session_id?: string;
    engagement_time_msec: number;
  };
}

/**
 * L'evento di una richiesta, o `null` se non va contato. Puro: tutto ciò che
 * decide sta negli argomenti, così si prova senza un server.
 */
export function eventoPerRichiesta(r: {
  url: string;
  rotta: string | undefined;
  metodo: string;
  stato: number;
  durataMs: number;
  cookies: Record<string, string | undefined>;
  measurementId: string;
}): { clientId: string; evento: EventoEndpoint } | null {
  const percorso = r.url.split("?")[0] ?? r.url;
  if (!percorso.startsWith("/api/") || r.metodo === "OPTIONS") return null;
  if (!leggiSceltaCookie(r.cookies[CONSENSO_COOKIE])?.s) return null;
  const clientId = clientIdDaCookie(r.cookies._ga);
  if (!clientId) return null;
  // Il modello della rotta, non l'indirizzo: `/api/tasks/:id`. Una rotta che
  // Fastify non conosce (404) si conta come tale, senza ripetere cosa si è
  // provato a chiamare.
  const endpoint = r.rotta ?? "(sconosciuta)";
  if (ESCLUSE.has(endpoint)) return null;
  const sessione = sessionIdDaCookie(r.cookies[`_ga_${r.measurementId.replace(/^G-/, "")}`]);
  return {
    clientId,
    evento: {
      name: "api_request",
      params: {
        endpoint: endpoint.slice(0, 100),
        method: r.metodo,
        status_code: r.stato,
        duration_ms: Math.round(r.durataMs),
        ...(sessione ? { session_id: sessione } : {}),
        // Senza, GA4 non conta l'evento come parte di una visita attiva.
        engagement_time_msec: 1,
      },
    },
  };
}

/**
 * Gli eventi in attesa, per visitatore: il Measurement Protocol ne accetta
 * fino a 25 per richiesta, e una richiesta verso Google per ogni chiamata
 * all'API raddoppierebbe il lavoro di rete del server per niente.
 */
interface Coda {
  eventi: EventoEndpoint[];
  ruolo: string | null;
}
const code = new Map<string, Coda>();
const MAX_PER_INVIO = 25;
const OGNI_MS = 5000;
let timer: NodeJS.Timeout | null = null;
let avvisato = false;

async function invia(clientId: string, coda: Coda): Promise<void> {
  const analytics = config.analytics;
  if (!analytics?.apiSecret) return;
  const url =
    `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(analytics.measurementId)}` +
    `&api_secret=${encodeURIComponent(analytics.apiSecret)}`;
  for (let i = 0; i < coda.eventi.length; i += MAX_PER_INVIO) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          ...(coda.ruolo ? { user_properties: { user_role: { value: coda.ruolo } } } : {}),
          events: coda.eventi.slice(i, i + MAX_PER_INVIO),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      // Google che non risponde non è un problema della demo: si dice una volta.
      if (!avvisato) {
        avvisato = true;
        console.warn(
          `[analytics] invio a GA non riuscito: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/** Manda tutto ciò che è in coda. Esportata per i test e per lo spegnimento. */
export async function svuotaCoda(): Promise<void> {
  const tutte = [...code.entries()];
  code.clear();
  await Promise.all(tutte.map(([clientId, coda]) => invia(clientId, coda)));
}

function accoda(clientId: string, evento: EventoEndpoint, ruolo: string | null): void {
  const coda = code.get(clientId) ?? { eventi: [], ruolo };
  coda.eventi.push(evento);
  if (ruolo) coda.ruolo = ruolo;
  code.set(clientId, coda);
  if (coda.eventi.length >= MAX_PER_INVIO) {
    code.delete(clientId);
    void invia(clientId, coda);
  }
}

export function registerAnalytics(app: FastifyInstance): void {
  const analytics = config.analytics;
  // Niente GA, o GA senza segreto: il server non manda niente (la pagina
  // conta comunque le funzioni, se l'identificativo c'è).
  if (!analytics?.apiSecret) return;
  timer = setInterval(() => void svuotaCoda(), OGNI_MS);
  timer.unref();
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    await svuotaCoda();
  });
  app.addHook("onResponse", async (request: FastifyRequest, reply) => {
    const esito = eventoPerRichiesta({
      url: request.url,
      rotta: request.routeOptions.url,
      metodo: request.method,
      stato: reply.statusCode,
      durataMs: reply.elapsedTime,
      cookies: request.cookies ?? {},
      measurementId: analytics.measurementId,
    });
    if (!esito) return;
    accoda(esito.clientId, esito.evento, request.currentUser?.role ?? null);
  });
}
