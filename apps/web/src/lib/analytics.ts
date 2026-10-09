/**
 * **Google Analytics della demo, nel browser** (18/09/2026).
 *
 * Solo dove il server lo dice (`/api/auth/providers` → `demo.analytics`, che
 * esiste solo in una demo con GA configurato) e solo dopo un **sì esplicito**
 * alle statistiche: fino ad allora gtag non si scarica nemmeno, e nessun
 * cookie di Google finisce nel browser. È un consenso a sé, distinto da quello
 * per restare connessi: sono due scopi diversi, e chi dice sì a uno non ha
 * detto sì all'altro.
 *
 * Ciò che parte: la **pagina** aperta, con gli identificativi sostituiti da
 * `:id` (`/progetti/:id`, mai l'id del progetto), e il titolo uguale al
 * percorso — il titolo del documento contiene nomi di task e clienti, e non
 * va a Google. Il ruolo di chi guarda (ADMIN, MEMBER…) come proprietà
 * dell'utente: è ciò che separa i percorsi. Gli endpoint li conta il server
 * (`modules/analytics/ga.ts`), con lo stesso consenso.
 */

import {
  CONSENSO_COOKIE,
  REGISTRO_CONSENSI,
  VERSIONE_INFORMATIVA,
  dominioCondiviso,
  etichettaScelta,
  leggiSceltaCookie,
  scriviSceltaCookie,
  type SceltaCookie,
} from "@kancrm/shared";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * La scelta sulle statistiche: **la stessa del sito** keelops.it, in un cookie
 * sul dominio di primo livello (`consenso-cookie.ts`). Chi ha risposto là non
 * si sente rifare la domanda qui, e viceversa. `null`: non ha ancora scelto, o
 * ha scelto su un'informativa più vecchia.
 */
export function leggiConsensoStatistiche(): "1" | "0" | null {
  const scelta = leggiScelta();
  return scelta ? (scelta.s ? "1" : "0") : null;
}

function leggiScelta(): SceltaCookie | null {
  const riga = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENSO_COOKIE}=`));
  return leggiSceltaCookie(riga?.slice(CONSENSO_COOKIE.length + 1));
}

export function scriviConsensoStatistiche(valore: "1" | "0"): void {
  const prima = leggiScelta();
  const scelta: SceltaCookie = {
    id: prima?.id ?? `c-${crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`}`,
    v: VERSIONE_INFORMATIVA,
    s: valore === "1",
    // La pubblicità la chiede il sito: qui la si lascia com'era.
    m: prima?.m ?? false,
    t: new Date().toISOString(),
  };
  const testo = scriviSceltaCookie(scelta);
  const dominio = dominioCondiviso(window.location.hostname);
  const sicuro = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENSO_COOKIE}=${testo}; Max-Age=31536000; Path=/; SameSite=Lax${
    dominio ? `; Domain=${dominio}` : ""
  }${sicuro}`;
  void registra(prima, scelta, testo);
  if (valore === "0") dimenticaGoogle();
}

/**
 * La prova della scelta, nello **stesso registro del sito**: senza, un sì dato
 * nella demo non si potrebbe dimostrare. L'impronta è lo SHA-256 del valore
 * rimasto nel browser, come fa il sito. Il registro è nostro: se non risponde,
 * la scelta vale lo stesso.
 */
async function registra(prima: SceltaCookie | null, dopo: SceltaCookie, testo: string) {
  if (!dominioCondiviso(window.location.hostname)) return;
  let impronta = "";
  try {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(testo)),
    );
    impronta = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    /* senza crypto.subtle la riga parte senza impronta */
  }
  const corpo = JSON.stringify({
    id: dopo.id,
    impronta,
    scelta: etichettaScelta(prima, dopo),
    statistiche: dopo.s,
    marketing: dopo.m,
    versione: dopo.v,
    lingua: document.documentElement.lang,
    pagina: `${window.location.origin}${normalizzaPercorso(window.location.pathname)}`,
  });
  try {
    if (
      navigator.sendBeacon?.(REGISTRO_CONSENSI, new Blob([corpo], { type: "application/json" }))
    ) {
      return;
    }
  } catch {
    /* si riprova con fetch */
  }
  fetch(REGISTRO_CONSENSI, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corpo,
    keepalive: true,
    credentials: "include",
  }).catch(() => undefined);
}

/**
 * Toglie i cookie di GA (`_ga`, `_ga_<contenitore>`): chi ritira il consenso
 * non deve restare riconoscibile. gtag li scrive sul dominio di primo livello
 * utile, quindi si cancellano sia sull'host sia sul dominio col punto.
 */
function dimenticaGoogle(): void {
  const nomi = document.cookie
    .split("; ")
    .map((c) => c.split("=")[0]!)
    .filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const host = window.location.hostname;
  const parti = host.split(".");
  const domini = [host, ...parti.slice(1).map((_, i) => `.${parti.slice(i + 1).join(".")}`)];
  for (const nome of nomi) {
    document.cookie = `${nome}=; Max-Age=0; Path=/`;
    for (const d of domini) document.cookie = `${nome}=; Max-Age=0; Path=/; Domain=${d}`;
  }
}

/**
 * Il percorso senza dati: ogni pezzo che sembra un identificativo — un cuid,
 * un uuid, un numero — diventa `:id`. La query si toglie: contiene ricerche e
 * filtri scritti da chi usa la demo.
 */
export function normalizzaPercorso(percorso: string): string {
  const senzaQuery = percorso.split(/[?#]/)[0] ?? "/";
  const pezzi = senzaQuery
    .split("/")
    .map((pezzo) =>
      /^\d+$/.test(pezzo) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pezzo) ||
      /^c[a-z0-9]{20,}$/i.test(pezzo) ||
      /^[A-Za-z0-9_-]{24,}$/.test(pezzo)
        ? ":id"
        : pezzo,
    );
  const unito = pezzi.join("/");
  return unito.length > 1 ? unito.replace(/\/$/, "") : "/";
}

let caricato: string | null = null;

/** Scarica gtag una volta sola, senza vista automatica: le pagine le manda `vistaPagina`. */
export function caricaGoogleAnalytics(measurementId: string): void {
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  // Già nella pagina: si guarda il documento, non una variabile, che
  // sopravviverebbe a uno script tolto.
  if (caricato === measurementId && document.querySelector(`script[src="${src}"]`)) return;
  caricato = measurementId;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag vuole proprio `arguments`, non un array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags: "SameSite=Lax;Secure",
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function vistaPagina(percorso: string): void {
  if (!caricato || !window.gtag) return;
  const pulito = normalizzaPercorso(percorso);
  window.gtag("event", "page_view", {
    page_path: pulito,
    page_location: `${window.location.origin}${pulito}`,
    page_title: pulito,
  });
}

export function ruoloDiChiGuarda(ruolo: string | null): void {
  if (!caricato || !window.gtag) return;
  window.gtag("set", "user_properties", { user_role: ruolo ?? "anonimo" });
}
