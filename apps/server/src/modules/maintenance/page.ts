// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { serverT } from "../../i18n";

/**
 * La pagina di cortesia della manutenzione: elegante, autosufficiente (CSS e
 * script inline, nessuna risorsa esterna), nei due temi, e nella lingua del
 * visitatore. Riprova da sola: interroga /api/maintenance e si ricarica quando
 * KeelOps torna online — chi la lascia aperta rientra senza fare niente.
 */
export function renderMaintenancePage(locale: string, message: string | null): string {
  const t = (key: string) => serverT(locale, key);
  const esc = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KeelOps — ${esc(t("Siamo in manutenzione"))}</title>
<style>
:root{--carta:#f6f7f8;--inchiostro:#181d24;--tenue:#5c6570;--accento:#1c4a63;--onda:#dbe6ec}
@media (prefers-color-scheme:dark){:root{--carta:#12161b;--inchiostro:#e7eaed;--tenue:#98a2ad;--accento:#82bcd8;--onda:#1b2b35}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:var(--carta);color:var(--inchiostro);
  font:17px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;padding:1.5rem;
  overflow:hidden}
.scheda{max-width:30rem;text-align:center;position:relative;z-index:1}
.lockup{height:6.5rem;width:auto;color:var(--inchiostro)}
h1{font-size:1.35rem;font-weight:600;margin:.4rem 0 .6rem}
p{margin:.4rem 0;color:var(--tenue)}
.messaggio{margin-top:1rem;padding:.7rem 1.1rem;border:1px solid var(--onda);
  border-radius:.6rem;color:var(--inchiostro);background:color-mix(in srgb,var(--onda) 40%,transparent)}
.spia{display:inline-flex;align-items:center;gap:.55rem;margin-top:1.4rem;
  color:var(--tenue);font-size:.9rem}
.punto{width:.6rem;height:.6rem;border-radius:50%;background:var(--accento);
  animation:batti 2.2s ease-in-out infinite}
@keyframes batti{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
a.riprova{display:inline-block;margin-top:1.1rem;color:var(--accento);font-weight:600;
  text-decoration:none;border:1.5px solid var(--accento);border-radius:.55rem;padding:.45em 1.2em}
a.riprova:hover{background:var(--onda)}
.mare{position:fixed;left:0;right:0;bottom:0;height:16vh;min-height:90px;z-index:0;opacity:.6}
.mare svg{position:absolute;bottom:0;width:200%;height:100%;animation:onda 14s linear infinite}
.mare svg:nth-child(2){animation-duration:23s;animation-direction:reverse;opacity:.5;bottom:8px}
@keyframes onda{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.punto,.mare svg{animation:none}}
</style>
</head>
<body>
<main class="scheda">
  <svg class="lockup" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 330" fill="none" role="img" >

<g stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="M110,45 C118,95 130,150 145,213" stroke-width="4"/>
<path d="M110,45 C200,105 380,145 585,147" stroke-width="4"/>
<path d="M145,213 C260,228 420,200 588,169" stroke-width="4"/>
<path d="M585,147 C586,154 587,161 588,169" stroke-width="3"/>
<path d="M114,70 C207.8,121 385.2,152.2 585.5,150" stroke-width="1.6" opacity="0.85"/>
<path d="M119,97 C216.2,138.2 390.8,159.9 586,153" stroke-width="1.6" opacity="0.85"/>
<path d="M125,125 C225.2,156.7 396.8,168.1 586.5,157" stroke-width="1.6" opacity="0.85"/>
<path d="M131,152 C234.8,176.3 403.2,176.9 587,160" stroke-width="1.4" opacity="0.7"/>
<path d="M138,180 C245,197 410,186 587.5,164" stroke-width="1.2" opacity="0.55"/>
<path d="M298,143 L300,166" stroke-width="1.2" opacity="0.45"/>
<path d="M418,152 L419,177" stroke-width="1.2" opacity="0.35"/>
<path d="M508,151 L509,171" stroke-width="1.1" opacity="0.28"/>
<path d="M60,232 L188,232" stroke-width="2.4" opacity="0.9"/>
<path d="M232,229 L392,229" stroke-width="1.8" opacity="0.6"/>
<path d="M436,226 L620,226" stroke-width="1.4" opacity="0.4"/>
<path d="M96,244 L152,244" stroke-width="1.6" opacity="0.45"/>
<path d="M262,242 L318,242" stroke-width="1.4" opacity="0.35"/>
<path d="M470,239 L536,239" stroke-width="1.2" opacity="0.25"/>
</g>
<text x="340" y="300" text-anchor="middle" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Inter, Helvetica, Arial, sans-serif" font-size="38" font-weight="500" letter-spacing="0.7">Keel<tspan font-weight="400" opacity="0.62">Ops</tspan></text>
</svg>
  <span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden">KeelOps</span>
  <h1>${esc(t("Siamo in manutenzione"))}</h1>
  <p>${esc(t("Stiamo aggiornando il sistema: torniamo online tra pochi minuti."))}</p>
  ${message ? `<p class="messaggio">${esc(message)}</p>` : ""}
  <div class="spia"><span class="punto"></span>${esc(t("Questa pagina riproverà da sola."))}</div>
  <div><a class="riprova" href="">${esc(t("Riprova ora"))}</a></div>
</main>
<div class="mare" aria-hidden="true">
  <svg viewBox="0 0 1200 100" preserveAspectRatio="none"><path d="M0 60 Q150 20 300 60 T600 60 T900 60 T1200 60 V100 H0 Z" fill="var(--onda)"/></svg>
  <svg viewBox="0 0 1200 100" preserveAspectRatio="none"><path d="M0 70 Q150 40 300 70 T600 70 T900 70 T1200 70 V100 H0 Z" fill="var(--onda)"/></svg>
</div>
<script src="/api/maintenance/retry.js" defer></script>
</body>
</html>`;
}
