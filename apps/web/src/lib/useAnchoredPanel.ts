import { useLayoutEffect, useRef, useState } from "react";

/**
 * **Una tendina che vive fuori dal suo contenitore.**
 *
 * Disegnata in posizione assoluta dentro il campo, viene tagliata da qualunque
 * antenato che scorre — una dialog, un pannello laterale, una tabella con
 * `overflow-x-auto`. È successo due volte: in un dialogo stretto si vedeva
 * mezza voce (24/08/2026, «Nuovo contatto») e nella tabella degli utenti il
 * selettore dell'azienda si apriva mozzato (02/09/2026).
 *
 * La prima volta la cura è stata scritta dentro `components/ui/combobox.tsx`, e
 * la seconda volta è servita altrove: quindi vive qui, in un posto solo, con le
 * sue prove. Chi la usa mette `ref` sull'elemento da agganciare e disegna il
 * pannello **in un portale** su `document.body`, in posizione `fixed` con le
 * misure che escono da qui: così nessun contenitore lo può più ritagliare.
 *
 * La posizione si ricalcola all'apertura, mentre qualcosa scorre e quando la
 * finestra cambia misura. Se sotto non c'è spazio, il pannello si apre in su.
 */
export interface PosizionePannello {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** L'altezza che il pannello si prende, e il minimo sotto cui non scende. */
const ALTEZZA_MASSIMA = 256;
const ALTEZZA_MINIMA = 120;
/** Quanto vuole vedersi sotto per non ribaltarsi in su, e il respiro dai bordi. */
const SPAZIO_PREFERITO = 200;
const MARGINE = 8;

/**
 * Calcola dove va il pannello, dato il rettangolo dell'elemento a cui è
 * agganciato e l'altezza della finestra. **Pura**: è la parte che si prova
 * senza un browser.
 */
export function posizionaPannello(
  ancora: { left: number; right: number; top: number; bottom: number; width: number },
  altezzaFinestra: number,
): PosizionePannello {
  const sotto = altezzaFinestra - ancora.bottom - MARGINE;
  const sopra = ancora.top - MARGINE;
  // Sotto se ci sta; altrimenti dalla parte che offre più spazio.
  const versoBasso = sotto >= SPAZIO_PREFERITO || sotto >= sopra;
  const spazio = Math.max(ALTEZZA_MINIMA, Math.min(ALTEZZA_MASSIMA, versoBasso ? sotto : sopra));
  return {
    left: ancora.left,
    width: ancora.width,
    top: versoBasso ? ancora.bottom + 4 : ancora.top - 4 - spazio,
    maxHeight: spazio,
  };
}

export function useAnchoredPanel<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
): {
  ancora: React.RefObject<T>;
  posizione: PosizionePannello | null;
} {
  const ancora = useRef<T>(null);
  const [posizione, setPosizione] = useState<PosizionePannello | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosizione(null);
      return;
    }
    const misura = (): void => {
      const el = ancora.current;
      if (!el) return;
      setPosizione(posizionaPannello(el.getBoundingClientRect(), window.innerHeight));
    };
    misura();
    // `capture`: lo scorrimento di un contenitore interno non risale fino a window.
    window.addEventListener("scroll", misura, true);
    window.addEventListener("resize", misura);
    return () => {
      window.removeEventListener("scroll", misura, true);
      window.removeEventListener("resize", misura);
    };
  }, [open]);

  return { ancora, posizione };
}
