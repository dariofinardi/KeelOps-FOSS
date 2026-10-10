// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { codeLanguage } from "@kancrm/shared";

/**
 * **L'evidenziatore del codice**, in un modulo suo.
 *
 * Non sta in `AttachmentViewer` perché le ventisei righe di `import()` qui
 * sotto entrano nel grafo di ogni file che lo importa: il lettore lo carica
 * ogni pagina che mostra un allegato, e il costo si pagava anche solo per
 * aprire un PDF. Isolato, lo paga chi apre un file di codice (18/08/2026).
 */
/**
 * Le grammatiche, **una per una**.
 *
 * `import("highlight.js")` tira dentro tutti i ~190 linguaggi del progetto:
 * 956 KB di chunk, con dentro `brainfuck` e `scilab`, per i venticinque che
 * qui servono davvero (18/08/2026). Il nucleo pesa una trentina di KB e ogni
 * grammatica qualche KB, caricata **solo quando si apre un file di quel
 * linguaggio**.
 *
 * L'elenco è esplicito e non un `import` con la stringa calcolata: così è Vite
 * a sapere quali file esistono, e nel pacchetto finiscono venticinque pezzetti
 * invece di centonovanta.
 */
const GRAMMARS: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  php: () => import("highlight.js/lib/languages/php"),
  java: () => import("highlight.js/lib/languages/java"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  swift: () => import("highlight.js/lib/languages/swift"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  go: () => import("highlight.js/lib/languages/go"),
  rust: () => import("highlight.js/lib/languages/rust"),
  bash: () => import("highlight.js/lib/languages/bash"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  sql: () => import("highlight.js/lib/languages/sql"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  diff: () => import("highlight.js/lib/languages/diff"),
  accesslog: () => import("highlight.js/lib/languages/accesslog"),
};

/**
 * **Codice sorgente**, colorato. Il linguaggio viene dall'estensione
 * (`codeLanguage`); se non la riconosciamo, o se la grammatica non è fra quelle
 * caricate, si mostra il testo senza colori — che è comunque meglio di un
 * download.
 *
 * `highlight.js` produce HTML **con il codice già scappato**: è il suo mestiere,
 * ed è per questo che qui l'`innerHTML` è ammesso dove altrove non lo sarebbe.
 */
export async function highlightInto(testo: string, name: string, host: HTMLElement): Promise<void> {
  const lingua = codeLanguage(name);
  const pre = document.createElement("pre");
  pre.className = "overflow-x-auto rounded border bg-background p-4 text-xs leading-relaxed";
  const code = document.createElement("code");

  const carica = lingua ? GRAMMARS[lingua] : undefined;
  if (lingua && carica) {
    const [core, grammatica] = await Promise.all([import("highlight.js/lib/core"), carica()]);
    const hljs = core.default;
    if (!hljs.getLanguage(lingua)) {
      hljs.registerLanguage(lingua, grammatica.default as never);
    }
    code.innerHTML = hljs.highlight(testo, { language: lingua }).value;
    code.className = `hljs language-${lingua}`;
  } else {
    code.textContent = testo;
  }
  pre.append(code);
  host.append(pre);
}
