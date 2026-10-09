import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResizeDivider } from "@/components/ui/resize-divider";

/**
 * **La conversazione ancorata in fondo al pannello, e regolabile a mano.**
 *
 * È la parte per cui un record si apre — rispondere a una richiesta, commentare
 * un task, concordare una cifra su un'offerta — e in fondo a una colonna lunga
 * la si trovava solo scorrendo. Qui vive sotto l'area che scorre, con un
 * divisore che è anche la maniglia: si trascina per decidere quanto spazio
 * darle, e il chevron la richiude del tutto.
 *
 * **Sta in un posto solo di proposito.** Il meccanismo è nato nel pannello del
 * task (20/08/2026) e ci era rimasto: il ticket aveva la stessa zona ancorata
 * ma senza maniglia, l'offerta nemmeno quella — la chat scorreva via insieme ai
 * campi. Tre copie della stessa idea sarebbero divergite alla prima modifica
 * (24/08/2026).
 */

/**
 * L'altezza minima: 22rem, quella che la zona aveva quando non si poteva
 * ancora trascinare. Si cresce da qui, non si scende.
 */
const CHAT_MIN = 352;

/**
 * Sotto questa altezza non si stringe trascinando: sono l'ultimo messaggio e il
 * campo per rispondere. Per farla sparire del tutto c'è il chevron — un gesto
 * solo, e reversibile.
 */
const CHAT_FLOOR = 160;

/**
 * Altezza e stato di chiusura **non si ricordano**, contro la regola generale
 * dei filtri: il pannello parte sempre dall'altezza di partenza (richiesta
 * esplicita del 20/08/2026). Un pannello che si riapre com'era è comodo quando
 * lo si usa sempre allo stesso modo; qui i record sono diversi fra loro — uno
 * ha una chat di quaranta messaggi e il successivo nessuna — e ritrovare la
 * chat chiusa su un record appena aperto sembrerebbe un guasto.
 */
export function ChatDock({
  children,
  /** Quanti messaggi ci sono: la banda chiusa lo dice, o sembrerebbe vuota. */
  count,
  /** Il record aperto: cambiandolo la chat torna a incollarsi in fondo. */
  recordId,
  /** Il corpo che scorre: serve a non far mangiare alla chat più di due terzi. */
  bodyRef,
  /**
   * Sul telefono i pannelli con più sezioni ne mostrano una per volta: qui si
   * dichiara se tocca alla conversazione. Chi non ha sezioni lascia il default.
   */
  mobileVisible = true,
}: {
  children: ReactNode;
  count: number;
  recordId: string;
  bodyRef?: RefObject<HTMLDivElement | null>;
  mobileVisible?: boolean;
}) {
  const { t } = useTranslation();
  /**
   * `null` = **non toccata**: la zona si adatta al contenuto fino al tetto di
   * `CHAT_MIN`, che è il comportamento di sempre — una chat di due messaggi
   * resta bassa invece di riservarsi trecento pixel vuoti.
   *
   * Appena si trascina diventa un'**altezza vera**. Il primo tentativo alzava
   * il tetto e basta: con la conversazione più corta del tetto, trascinare non
   * cambiava niente e sembrava rotto (20/08/2026, visto nel browser).
   */
  const [altezzaChat, setAltezzaChat] = useState<number | null>(null);
  const [chatChiusa, setChatChiusa] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  /**
   * **La conversazione si apre in fondo**, dove ci sono l'ultimo messaggio e il
   * campo per rispondere: con quaranta messaggi si atterrava sul più vecchio.
   * Resta incollata in fondo finché è chi legge a non allontanarsene: scorrendo
   * verso l'alto per rileggere, un messaggio nuovo non deve strappare la pagina.
   */
  const inFondo = useRef(true);
  const segnaScorrimento = () => {
    const zona = chatRef.current;
    if (zona) inFondo.current = zona.scrollHeight - zona.scrollTop - zona.clientHeight < 24;
  };
  useEffect(() => {
    const zona = chatRef.current;
    if (!zona || chatChiusa) return;
    const scendi = () => {
      if (inFondo.current) zona.scrollTop = zona.scrollHeight;
    };
    scendi();
    // I messaggi arrivano dopo (query a parte): si guarda crescere il contenuto,
    // non il contenitore, che l'altezza ce l'ha già.
    if (typeof ResizeObserver === "undefined" || !zona.firstElementChild) return;
    const osservatore = new ResizeObserver(scendi);
    osservatore.observe(zona.firstElementChild);
    return () => osservatore.disconnect();
  }, [chatChiusa, recordId]);

  // Oltre questo il pannello non avrebbe più spazio per i campi: due terzi.
  const chatMax = Math.max(CHAT_MIN, (bodyRef?.current?.clientHeight ?? 900) * 0.66);
  /** Quanto è alta adesso: la misura vera se non è stata toccata, o la scelta. */
  const altezzaVisibile = altezzaChat ?? chatRef.current?.offsetHeight ?? CHAT_MIN;

  return (
    <>
      {/* Il divisore è anche la maniglia: si vede perché è spesso e tinto, e
          dice da sé che si può spostare. Sul telefono non c'è — lì la chat è
          una sezione e prende tutto lo spazio che ha. */}
      <ResizeDivider
        className="max-sm:hidden"
        label={t("Altezza della conversazione")}
        value={altezzaVisibile}
        min={CHAT_FLOOR}
        max={chatMax}
        disabled={chatChiusa}
        onChange={setAltezzaChat}
        // Chiusa, la banda dice cosa c'è sotto: una striscia grigia e muta si
        // legge come un difetto, non come una sezione richiusa.
        hint={chatChiusa ? t("Conversazione ({{count}})", { count }) : undefined}
        action={
          <button
            type="button"
            aria-expanded={!chatChiusa}
            title={chatChiusa ? t("Mostra la conversazione") : t("Riduci la conversazione")}
            aria-label={chatChiusa ? t("Mostra la conversazione") : t("Riduci la conversazione")}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={() => setChatChiusa((chiusa) => !chiusa)}
          >
            {chatChiusa ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        }
      />
      <div
        ref={chatRef}
        // Appiglio per la prova nel browser: l'altezza di questa zona è
        // esattamente ciò che il trascinamento deve cambiare.
        data-chat=""
        onScroll={segnaScorrimento}
        // Non toccata: un tetto, e la zona si adatta al contenuto. Toccata:
        // un'altezza, perché è quella che è stata chiesta.
        style={
          altezzaChat === null
            ? ({ maxHeight: `${CHAT_MIN}px` } as CSSProperties)
            : ({ height: `${altezzaChat}px` } as CSSProperties)
        }
        hidden={chatChiusa}
        className={cn(
          // `[&>section]:mt-0`: la chat nasce con un margine sopra che serviva
          // quando stava in fondo alla colonna. Ancorata, quel margine è un
          // buco fra il bordo e il titolo.
          "flex-none overflow-y-auto px-4 py-3 [&>section]:mt-0",
          // Sul telefono l'altezza scelta non vale: la chat è una sezione a sé
          // e prende lo spazio flessibile. `h-auto!` batte lo stile in linea.
          "max-sm:h-auto! max-sm:max-h-none! max-sm:min-h-0 max-sm:flex-1 max-sm:border-t",
          mobileVisible ? "max-sm:block" : "max-sm:hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
