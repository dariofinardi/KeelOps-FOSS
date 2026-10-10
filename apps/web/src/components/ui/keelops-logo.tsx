// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Il marchio KeelOps, inline e in un punto solo: gli SVG usano `currentColor`,
 * quindi ereditano il colore del testo e vivono da soli nei due temi.
 * Sorgenti in `assets/` alla radice del repository.
 *
 * **Gli attributi sono in camelCase**, non come nell'SVG di partenza: React non
 * riconosce `stroke-width` e compagni, e a ogni disegno del marchio — cioè a
 * ogni pagina — ne avvisava in console. Copiando un SVG nuovo qui dentro, i
 * trattini vanno tolti.
 */

export function KeelopsMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} aria-hidden={title ? undefined : true} xmlns="http://www.w3.org/2000/svg" viewBox="190 35 300 300" fill="none" role="img" >
{title ? <title>{title}</title> : null}
<g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
<path d="M218,82 C222,110 234,168 246,236" strokeWidth="4.5"/>
<path d="M218,82 C262,110 350,170 466,188" strokeWidth="4.5"/>
<path d="M246,236 C300,254 400,232 468,209" strokeWidth="4.5"/>
<path d="M466,188 C467,195 467,202 468,209" strokeWidth="3.2"/>
<path d="M220,102 C266.9,128.7 356.5,178.1 466.3,191" strokeWidth="1.8" opacity="0.85"/>
<path d="M223,124 C272.3,148.9 363.5,186.7 466.6,194" strokeWidth="1.8" opacity="0.82"/>
<path d="M227,147 C278,170.5 371,196 467,197" strokeWidth="1.6" opacity="0.72"/>
<path d="M232,171 C284,193.5 379,205.9 467.3,200" strokeWidth="1.4" opacity="0.58"/>
<path d="M238,197 C290.5,218 387.5,216.5 467.7,204" strokeWidth="1.2" opacity="0.42"/>
<path d="M320,146 L321,190" strokeWidth="1.2" opacity="0.32"/>
<path d="M400,172 L401,206" strokeWidth="1.1" opacity="0.24"/>
<path d="M212,272 L318,272" strokeWidth="2.4" opacity="0.85"/>
<path d="M348,268 L468,268" strokeWidth="1.6" opacity="0.5"/>
<path d="M244,286 L296,286" strokeWidth="1.6" opacity="0.42"/>
<path d="M392,282 L442,282" strokeWidth="1.2" opacity="0.28"/>
</g>
</svg>
  );
}

/** Marchio + nome: per l'accesso e le testate dei documenti. */
export function KeelopsLockup({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} aria-hidden={title ? undefined : true} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 330" fill="none" role="img" >
{title ? <title>{title}</title> : null}
<g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
<path d="M110,45 C118,95 130,150 145,213" strokeWidth="4"/>
<path d="M110,45 C200,105 380,145 585,147" strokeWidth="4"/>
<path d="M145,213 C260,228 420,200 588,169" strokeWidth="4"/>
<path d="M585,147 C586,154 587,161 588,169" strokeWidth="3"/>
<path d="M114,70 C207.8,121 385.2,152.2 585.5,150" strokeWidth="1.6" opacity="0.85"/>
<path d="M119,97 C216.2,138.2 390.8,159.9 586,153" strokeWidth="1.6" opacity="0.85"/>
<path d="M125,125 C225.2,156.7 396.8,168.1 586.5,157" strokeWidth="1.6" opacity="0.85"/>
<path d="M131,152 C234.8,176.3 403.2,176.9 587,160" strokeWidth="1.4" opacity="0.7"/>
<path d="M138,180 C245,197 410,186 587.5,164" strokeWidth="1.2" opacity="0.55"/>
<path d="M298,143 L300,166" strokeWidth="1.2" opacity="0.45"/>
<path d="M418,152 L419,177" strokeWidth="1.2" opacity="0.35"/>
<path d="M508,151 L509,171" strokeWidth="1.1" opacity="0.28"/>
<path d="M60,232 L188,232" strokeWidth="2.4" opacity="0.9"/>
<path d="M232,229 L392,229" strokeWidth="1.8" opacity="0.6"/>
<path d="M436,226 L620,226" strokeWidth="1.4" opacity="0.4"/>
<path d="M96,244 L152,244" strokeWidth="1.6" opacity="0.45"/>
<path d="M262,242 L318,242" strokeWidth="1.4" opacity="0.35"/>
<path d="M470,239 L536,239" strokeWidth="1.2" opacity="0.25"/>
</g>
<text x="340" y="300" text-anchor="middle" fill="currentColor" font-family="system-ui, -apple-system, 'Segoe UI', Inter, Helvetica, Arial, sans-serif" font-size="38" font-weight="500" letter-spacing="0.7">Keel<tspan font-weight="400" opacity="0.62">Ops</tspan></text>
</svg>
  );
}
