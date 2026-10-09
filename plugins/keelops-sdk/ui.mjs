/**
 * The KeelOps look for plugin pages: one place for tokens, the card shell,
 * the system font stack and the app's lucide glyphs. Server-rendered pages
 * interpolate the constants; a static UI can serve BASE_CSS from a tiny
 * route (see TasksMap's /base.css) and link it.
 *
 * Everything is self-contained on purpose: plugins carry no dependencies,
 * and the product uses the system font stack — no webfonts to ship.
 */

/**
 * The KeelOps look, inherited from the application itself (07/09/2026).
 *
 * The colours are no longer a palette of our own: the first line pulls in
 * `/api/tema.css`, which the core generates from the same source the
 * application uses (`packages/shared/src/tema.css`) **already resolved for
 * the person looking** — light, dark, or the media query when their choice is
 * «follow the system». Before this, a plugin page followed the *operating
 * system* while the application followed the *user's choice*: whoever worked
 * in light mode on a dark machine saw black tiles inside a white page.
 *
 * The historic names (`--carta`, `--inchiostro`, …) stay, mapped onto the
 * application's tokens: three plugins are written against them, and the
 * fallbacks keep a page alive even where `/api/tema.css` cannot be reached
 * (a plugin running standalone in development).
 */
export const BASE_CSS = `
@import url("/api/tema.css");
:root{
  --carta:var(--background,#f6f7f8);
  --inchiostro:var(--foreground,#181d24);
  --tenue:var(--muted-foreground,#5c6570);
  --filo:var(--border,#d8dde2);
  --rilievo:var(--card,#fff);
  --accento:var(--primary,#1c4a63);
  --accento-fondo:var(--accent,#e6eef2);
  --pericolo:var(--destructive,#c2410c);
  --raggio:var(--radius,.625rem);
  --font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
/* Senza il foglio del core (plugin autonomo) restano i valori di sempre. */
@media (prefers-color-scheme:dark){:root{
  --carta:var(--background,#12161b);
  --inchiostro:var(--foreground,#e7eaed);
  --tenue:var(--muted-foreground,#98a2ad);
  --filo:var(--border,#2b333c);
  --rilievo:var(--card,#191f26);
  --accento:var(--primary,#82bcd8);
  --accento-fondo:var(--accent,#1b2b35)}
  .logo-chiaro{display:none}} @media (prefers-color-scheme:light){.logo-scuro{display:none}}
[data-tema="dark"] .logo-chiaro{display:none} [data-tema="light"] .logo-scuro{display:none}
*{box-sizing:border-box}
a{color:var(--accento);font-weight:600;text-decoration:none}
svg.icona{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round;vertical-align:-.15em;flex:none}
button svg.icona,a svg.icona{margin-right:.35em}
`;

/**
 * **La pagina segue il tema dell'applicazione che la ospita.**
 *
 * Un riquadro o una pagina di plugin vive in un iframe della **stessa
 * origine**: può guardare la classe `dark` sul documento che lo contiene, che
 * è la verità di quello che la persona sta vedendo adesso — comunque ci sia
 * arrivata (la scelta nel profilo, l'interruttore in barra, il sistema in
 * automatico). La rispecchia su `data-tema` di `<html>`, e il foglio del core
 * (`/api/tema.css`) ci mette sopra i colori giusti.
 *
 * Il `MutationObserver` serve al caso vero: si preme l'interruttore in barra e
 * i riquadri dei plugin devono cambiare con tutto il resto, non al prossimo
 * ricaricamento. Aperta da sola, senza un genitore, la pagina resta al foglio
 * del core: la scelta della persona, o il sistema se ha detto «automatico».
 *
 * Le pagine che hanno colori propri li scrivono su `[data-tema="dark"]`, mai
 * su `prefers-color-scheme`: quella direbbe il sistema operativo.
 */
export const TEMA_SCRIPT = `
(function () {
  var radice = document.documentElement;
  var genitore = null;
  try { genitore = window.parent !== window ? window.parent.document.documentElement : null; }
  catch (e) { genitore = null; }
  if (!genitore) return;
  var applica = function () {
    radice.dataset.tema = genitore.classList.contains("dark") ? "dark" : "light";
  };
  applica();
  new MutationObserver(applica).observe(genitore, { attributes: true, attributeFilter: ["class"] });
})();
`;

/** The centered single-card shell (consent pages, notices, sign-in, bridges). */
export const CARD_CSS = `
body{margin:0;background:var(--carta);color:var(--inchiostro);font:var(--font);
  display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.scheda{background:var(--rilievo);border:1px solid var(--filo);border-radius:.7rem;
  padding:2rem;max-width:26rem;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.08)}
.logo svg{height:2rem;width:auto;max-width:100%}
h1{font-size:1.15rem;margin:.9rem 0 .4rem}
p{margin:.5rem 0;color:var(--tenue)} strong{color:var(--inchiostro)}
`;

/** The app's lucide glyphs, inlined. Add here what the next plugin needs. */
export const ICONS = {
  copia: '<svg class="icona" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  conferma: '<svg class="icona" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  nega: '<svg class="icona" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  revoca: '<svg class="icona" viewBox="0 0 24 24"><path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
  indietro: '<svg class="icona" viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  entra: '<svg class="icona" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>',
  grip: '<svg class="icona grip" viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  comprimi: '<svg class="icona" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  esterno: '<svg class="icona" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
};

/**
 * A page shown inside a core panel (`PluginPanel`, an anchor that carries
 * content — the dashboard tile of a plugin) lives in an iframe, and an iframe
 * does not know how tall its content is. This snippet tells the parent after
 * every layout change; the parent resizes the frame. Inline it once, at the
 * end of the body: `<script src="sdk/riquadro.js" defer></script>`. **Never
 * inline**: production runs with `script-src 'self'` and an inline script is
 * not executed — in development the CSP is off, so it looks like it works.
 * The host serves that path for every plugin.
 */
/**
 * A page shown as a tile can also say it has NOTHING to show — a plugin's
 * dashboard tile with no rows — and the host hides the whole frame instead
 * of leaving an empty box on the page (07/09/2026):
 *
 *   window.parent.postMessage({ tipo: "keelops:vuoto", vuoto: true }, window.location.origin)
 *
 * `vuoto: false` shows it again. Only the frame's own page is listened to.
 */
export const FRAME_EMPTY_MESSAGE = "keelops:vuoto";

/**
 * Tells the host how tall this page is, so the frame can follow it.
 *
 * **Call this from a bundled page** (a React app, say) instead of injecting a
 * script: in production the CSP is `script-src 'self'`, so anything inline is
 * blocked — and it is blocked silently enough that the tile simply stays the
 * wrong height. A plain HTML page loads `sdk/riquadro.js` instead (the host
 * serves it for every plugin); that file is built from THIS function, so there
 * is one implementation and not two that drift.
 */
/*
 * This one function runs in the BROWSER, not in Node: it is the only piece of
 * this file that does. While it lived inside a template string the linter
 * could not see it — which is also why nobody noticed it was never running in
 * production. Now it is real code, and it says which globals it expects.
 */
/* global window, document, ResizeObserver */
export function avviaRiquadro() {
  if (window.parent === window) return;
  var send = function () {
    window.parent.postMessage(
      { tipo: "keelops:altezza", altezza: document.documentElement.scrollHeight },
      window.location.origin,
    );
  };
  new ResizeObserver(send).observe(document.documentElement);
  window.addEventListener("load", send);
  send();
}

/**
 * The same thing as a string, for the host to serve at `sdk/riquadro.js`.
 * Derived from the function above on purpose: a second copy of these six lines
 * is a second copy to keep in step.
 */
export const FRAME_RESIZE_SCRIPT = `(${avviaRiquadro.toString()})();`;

/**
 * **Le traduzioni delle pagine dei plugin** (22/09/2026), scritte una volta.
 *
 * Il meccanismo — l'italiano è la chiave, la lingua viene dalla preferenza
 * della persona in KeelOps, l'inglese fa da ripiego, `{nome}` si sostituisce —
 * era copiato in Presenze e in TasksMap, già con piccole differenze fra i due
 * (uno metteva l'aria-label sui titoli, l'altro no). Qui c'è l'unica versione;
 * ogni plugin porta solo i suoi cataloghi:
 *
 *   <script src="sdk/traduzioni.js"></script>
 *   <script src="i18n.js"></script>   // KeelOpsI18n.crea({ en: {…}, fr: {…} }, { titolo: "…" })
 *
 * Come `avviaRiquadro`, è codice vero che gira nel **browser**, servito come
 * file dal guscio (`sdk/traduzioni.js`): la CSP di produzione non esegue
 * niente di inline.
 */
/* global navigator */
export function avviaTraduzioni() {
  var LINGUE = ["it", "en", "fr", "de", "es", "pt"];
  function crea(cataloghi, opzioni) {
    cataloghi = cataloghi || {};
    opzioni = opzioni || {};
    var iniziale = String((navigator && navigator.language) || "it").slice(0, 2);
    var lingua = LINGUE.indexOf(iniziale) >= 0 ? iniziale : "it";
    function t(chiave, valori) {
      var testo = chiave;
      if (lingua !== "it") {
        var mia = cataloghi[lingua] || {};
        var inglese = cataloghi.en || {};
        testo = mia[chiave] != null ? mia[chiave] : inglese[chiave] != null ? inglese[chiave] : chiave;
      }
      if (valori) {
        for (var nome in valori) testo = testo.split("{" + nome + "}").join(String(valori[nome]));
      }
      return testo;
    }
    function applica() {
      document.documentElement.lang = lingua;
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        el.textContent = t(el.getAttribute("data-i18n"));
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
        el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
      });
      document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
        var testo = t(el.getAttribute("data-i18n-title"));
        el.setAttribute("title", testo);
        el.setAttribute("aria-label", testo);
      });
      if (opzioni.titolo) document.title = t(opzioni.titolo);
    }
    var i18n = {
      t: t,
      applica: applica,
      lingua: function () { return lingua; },
      /** La lingua della persona, da `api/me`: vince su quella del browser. */
      imposta: function (nuova) {
        var l = String(nuova || "").slice(0, 2);
        if (LINGUE.indexOf(l) >= 0) lingua = l;
        applica();
      },
    };
    window.i18n = i18n;
    window.t = t;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applica);
    else applica();
    return i18n;
  }
  window.KeelOpsI18n = { crea: crea, lingue: LINGUE };
}

/** Lo stesso, come testo: è ciò che il guscio serve a `sdk/traduzioni.js`. */
export const TRADUZIONI_SCRIPT = `(${avviaTraduzioni.toString()})();`;
