import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Traccia un separatore sopra questa voce. */
  separatorBefore?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * Menu contestuale (tasto destro) riutilizzabile. Ritorna un handler da
 * agganciare a `onContextMenu` di ogni elemento e il nodo `menu` da renderizzare
 * una volta nel componente. Si chiude con click esterno, Esc o scroll.
 */
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);

  const open = useCallback(
    (
      event: { preventDefault: () => void; clientX: number; clientY: number },
      items: ContextMenuItem[],
    ) => {
      event.preventDefault();
      if (items.length === 0) return;
      setState({ x: event.clientX, y: event.clientY, items });
    },
    [],
  );

  const close = useCallback(() => setState(null), []);

  const menu = state ? <ContextMenuView state={state} onClose={close} /> : null;
  return { open, close, menu };
}

/**
 * Tasto destro sullo spazio vuoto di un elenco (tra le righe, sotto l'ultima, o
 * quando l'elenco è vuoto): propone di creare. Da spargere sui contenitori delle
 * collezioni, così il tasto destro fa sempre qualcosa di sensato invece di
 * scoprire il menu del browser in mezzo all'applicazione.
 *
 * Due regole:
 * - se l'evento arriva da una riga che ha già aperto il proprio menu
 *   (`defaultPrevented`), il contenitore si tira indietro: vince il menu più
 *   specifico, quello dell'elemento;
 * - se non c'è nulla da offrire (l'utente non può creare) resta il menu del
 *   browser, che almeno permette ricarica, copia e ispeziona.
 */
export function useCreateAreaMenu(
  label: string,
  onCreate: (() => void) | null,
): { areaProps: { onContextMenu: (event: React.MouseEvent) => void }; menu: ReactNode } {
  const { open, menu } = useContextMenu();
  const onContextMenu = (event: React.MouseEvent) => {
    if (event.defaultPrevented || !onCreate) return;
    open(event, [{ label, icon: <Plus className="size-4" />, onSelect: onCreate }]);
  };
  return { areaProps: { onContextMenu }, menu };
}

function ContextMenuView({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // Riposiziona il menu se sborderebbe fuori dalla viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = state;
    if (x + rect.width > window.innerWidth) x = Math.max(8, window.innerWidth - rect.width - 8);
    if (y + rect.height > window.innerHeight) y = Math.max(8, window.innerHeight - rect.height - 8);
    setPos({ x, y });
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        role="menu"
        className="absolute min-w-44 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.items.map((item, index) => (
          <div key={index}>
            {item.separatorBefore && <div className="my-1 h-px bg-border" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                "hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50",
                item.danger && "text-destructive",
              )}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
