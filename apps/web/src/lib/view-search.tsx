import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Il canale tra le viste e il campo di ricerca della topbar.
 *
 * C'era una ricerca globale in alto e un "Cerca…" (più un combo tag) dentro la
 * barra filtri di ogni lista: due campi uguali a vista, poco comprensibili
 * (richiesta 10/08/2026). Ora il campo è UNO, in topbar, con l'interruttore
 * locale/globale: la vista che ha una lista filtrabile si REGISTRA qui — dice
 * come si chiama il suo filtro di testo e, se ce l'ha, quello dei tag — e la
 * topbar le scrive dentro. Dove nessuno si registra il campo è solo globale e
 * l'interruttore non compare: niente modi morti.
 *
 * Lo stato del filtro resta DELLA PAGINA (prefs comprese): la topbar è solo la
 * maniglia. Così "Azzera filtri" continua a svuotare tutto, e il campo in alto
 * si accorge del reset da sé, leggendo `q` dalla registrazione.
 */

export interface ViewSearchTag {
  /** "" = nessun tag selezionato. */
  tagId: string;
  setTagId: (id: string | null) => void;
}

export interface ViewSearchRegistration {
  /** Testo di ricerca corrente della vista. */
  q: string;
  /** Riceve il testo già a digitazione ferma (debounce unico in topbar). */
  setQ: (q: string) => void;
  /** Segnaposto specifico ("Cerca offerte…"); senza, un generico "Cerca…". */
  placeholder?: string;
  /** Filtro tag, solo per le viste che ce l'hanno (oggi le Bacheche). */
  tag?: ViewSearchTag;
}

interface ViewSearchContextValue {
  registration: ViewSearchRegistration | null;
  setRegistration: (registration: ViewSearchRegistration | null) => void;
}

const ViewSearchContext = createContext<ViewSearchContextValue | null>(null);

export function ViewSearchProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<ViewSearchRegistration | null>(null);
  const value = useMemo(() => ({ registration, setRegistration }), [registration]);
  return <ViewSearchContext.Provider value={value}>{children}</ViewSearchContext.Provider>;
}

/**
 * La VISTA si registra: chiamarlo con i propri `q`/`setQ` (e tag, se c'è) rende
 * attiva la ricerca locale in topbar; allo smontaggio ci si toglie da soli.
 * Le dipendenze sono i singoli campi, non l'oggetto: le pagine lo ricreano a
 * ogni render e un confronto per identità registrerebbe all'infinito.
 */
export function useViewSearch(registration: ViewSearchRegistration): void {
  // Senza provider (il portale clienti non usa AppShell) la registrazione è un
  // no-op: la pagina mostra il suo campo locale come ha sempre fatto.
  const context = useContext(ViewSearchContext);
  const setRegistration = context?.setRegistration;
  const { q, setQ, placeholder } = registration;
  const tagId = registration.tag?.tagId;
  const setTagId = registration.tag?.setTagId;
  // ATTENZIONE: `setQ`/`setTagId` devono essere STABILI (useCallback nella
  // pagina): sono dipendenze dell'effetto, e una funzione ricreata a ogni
  // render registrerebbe in loop.
  useEffect(() => {
    if (!setRegistration) return;
    setRegistration({
      q,
      setQ,
      placeholder,
      ...(setTagId !== undefined && tagId !== undefined ? { tag: { tagId, setTagId } } : {}),
    });
  }, [setRegistration, q, setQ, placeholder, tagId, setTagId]);
  useEffect(() => {
    if (!setRegistration) return;
    return () => setRegistration(null);
  }, [setRegistration]);
}

/** La TOPBAR legge la registrazione corrente (null = vista solo-globale). */
export function useViewSearchTarget(): ViewSearchRegistration | null {
  const context = useContext(ViewSearchContext);
  if (!context) throw new Error("useViewSearchTarget va usato dentro ViewSearchProvider");
  return context.registration;
}

/**
 * Comodità per le pagine che tengono `q` in un semplice stato locale: espone la
 * coppia `q`/`setQ` già stabile. (Quelle con `q` nelle prefs passano le loro.)
 */
export function useLocalSearchState(): { q: string; setQ: (q: string) => void } {
  const [q, setQ] = useState("");
  const stableSetQ = useCallback((value: string) => setQ(value), []);
  return { q, setQ: stableSetQ };
}
