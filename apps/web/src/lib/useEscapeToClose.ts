import { useEffect, useRef } from "react";

/**
 * Esc chiude ciò che si è aperto per ultimo.
 *
 * La pila è condivisa da **tutti** gli strati modali — dialog, pannelli
 * laterali, conferme — perché è l'unico modo di rispondere bene alla domanda
 * "cosa chiudo?": una conferma aperta sopra un pannello si chiude per prima, e
 * il pannello resta dov'è.
 *
 * Prima ogni pannello se la scriveva da sé (task, offerta, ticket) e il pannello
 * del CRM se n'era semplicemente dimenticato: Esc non chiudeva niente. Una
 * regola scritta quattro volte è una regola che prima o poi manca in un posto.
 *
 * `onClose` può cambiare a ogni render (spesso è una closure): si tiene in una
 * ref, così la pila non si riordina di continuo.
 */
const openLayers: Array<{ close: () => void }> = [];

export function useEscapeToClose(active: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const layer = { close: () => closeRef.current() };
    openLayers.push(layer);
    const onKeyDown = (event: KeyboardEvent) => {
      // Solo lo strato in cima risponde; gli altri aspettano il loro turno.
      if (event.key === "Escape" && openLayers[openLayers.length - 1] === layer) {
        layer.close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      const index = openLayers.lastIndexOf(layer);
      if (index >= 0) openLayers.splice(index, 1);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}
