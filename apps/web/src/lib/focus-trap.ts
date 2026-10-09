import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * I campi in cui si **scrive**: sono questi che meritano il fuoco all'apertura.
 *
 * Le `select` restano fuori di proposito: nei pannelli di dettaglio il primo
 * campo è spesso lo stato, i campi si salvano da soli, e una freccia premuta
 * per scorrere sposterebbe il task in un'altra colonna senza che nessuno
 * l'abbia chiesto. Chi vuole il fuoco altrove lo dichiara con `data-autofocus`.
 *
 * **Fuori anche le tendine** (`data-no-autofocus`): il campo di ricerca di una
 * combo è un `input`, ma prenderlo APRE l'elenco, che si spalanca sopra il
 * pannello appena aperto — nel dettaglio di un ticket il fuoco finiva su
 * "Cerca un incontro…" e la tendina copriva mezzo pannello (24/08/2026). Sono
 * comunque raggiungibili con Tab: qui si decide solo dove parte il fuoco.
 */
const NON_TENDINA = ":not([data-no-autofocus])";
const FIRST_FIELD = [
  // color/file/range non sono campi in cui si SCRIVE: sono selettori, e il
  // fuoco iniziale su una pastiglia di colore non serve a nessuno
  `input:not([disabled]):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="file"]):not([type="range"])${NON_TENDINA}`,
  `textarea:not([disabled]):not([readonly])${NON_TENDINA}`,
  `[contenteditable="true"]${NON_TENDINA}`,
].join(", ");

/**
 * Rende un contenitore una vera modale da tastiera: Tab ciclico all'interno,
 * ripristino del fuoco all'elemento precedente alla chiusura, e **fuoco
 * iniziale sul primo campo da compilare**.
 *
 * L'ordine è: `[data-autofocus]` se c'è, poi il primo campo di testo, poi il
 * primo elemento focalizzabile, infine il contenitore. Prima si prendeva
 * direttamente il primo focalizzabile — che nel markup è la **✕ di chiusura** —
 * e l'`autoFocus` scritto sul campo veniva scavalcato: si apriva una finestra
 * per scrivere e bisognava prima cliccare dentro (15/08/2026).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    /**
     * Il primo **visibile** della lista, o il primo e basta se la visibilità non
     * si può misurare: `offsetParent` è nullo per un elemento nascosto ma anche
     * ovunque non ci sia un vero motore di disegno (i test), e un filtro che
     * scarta tutto lascerebbe il fuoco al contenitore — cioè in nessun posto.
     */
    const preferVisible = (elements: HTMLElement[]): HTMLElement | null =>
      elements.find((el) => el.offsetParent !== null) ?? elements[0] ?? null;

    const initial =
      preferVisible(Array.from(container.querySelectorAll<HTMLElement>("[data-autofocus]"))) ??
      preferVisible(Array.from(container.querySelectorAll<HTMLElement>(FIRST_FIELD))) ??
      preferVisible(
        Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute("data-no-autofocus"),
        ),
      ) ??
      container;
    // Senza `preventScroll` il contenitore salta al campo appena aperto, e su
    // un pannello lungo si perde l'intestazione che dice di cosa si parla.
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [active]);

  return ref;
}
