// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pagina rimasta aperta attraverso un rilascio.
 *
 * Il browser tiene in memoria l'`index.html` della versione vecchia, che nomina
 * chunk con l'impronta vecchia: dopo il deploy quei file non esistono più, e la
 * prima navigazione che ne carica uno fallisce. Non è un errore che l'utente
 * possa capire — la pagina semplicemente non si apre.
 *
 * Vite emette `vite:preloadError` quando un import dinamico non si carica: si
 * ricarica una volta sola, il che riporta l'index nuovo e i chunk giusti. Il
 * segno in `sessionStorage` evita il ciclo infinito se il guasto fosse un altro
 * (rete assente, server giù): al secondo tentativo si lascia passare l'errore.
 *
 * **Anche il foglio di stile conta** (20/08/2026): una pagina vecchia può
 * limitarsi a non trovare il proprio CSS e restare in piedi senza forma, senza
 * mai caricare un chunk nuovo — nessun `preloadError`, nessuna ricarica, e in
 * console tre errori diversi con una causa sola. Il `<link>` che fallisce è il
 * primo segnale che arriva, e vale come gli altri.
 */
const RELOADED = "kancrm-stale-build-reload";

export function watchStaleBuild(reload: () => void = () => window.location.reload()): () => void {
  const onPreloadError = (event: Event) => {
    if (sessionStorage.getItem(RELOADED)) return;
    event.preventDefault();
    sessionStorage.setItem(RELOADED, "1");
    reload();
  };
  // Caricamento andato a buon fine: il prossimo problema merita un tentativo.
  const onLoad = () => sessionStorage.removeItem(RELOADED);
  /**
   * Un `<link rel="stylesheet">` che non si carica: l'evento `error` non
   * bolle, quindi si ascolta in **fase di cattura** sulla finestra — altrimenti
   * non arriva mai.
   */
  const onResourceError = (event: Event) => {
    const nodo = event.target;
    if (!(nodo instanceof HTMLLinkElement) || nodo.rel !== "stylesheet") return;
    onPreloadError(event);
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("load", onLoad);
  return () => {
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("error", onResourceError, true);
    window.removeEventListener("load", onLoad);
  };
}
