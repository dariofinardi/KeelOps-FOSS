// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Pannello che si apre passando col cursore su un elemento di un elenco: serve a
 * sbirciare dentro una riga (gli allegati, la conversazione) senza aprire il task.
 *
 * Apre al passaggio del cursore, ma **non si chiude appena ci si allontana**: per
 * scorrere una chat o cliccare un allegato bisogna poterci entrare dentro. Si
 * chiude con un clic fuori, con Esc, o allontanandosi da entrambi (trigger e
 * pannello) per un istante. Si apre anche col fuoco da tastiera e col clic, così
 * non è raggiungibile solo col mouse.
 */
export function HoverPanel({
  label,
  trigger,
  children,
  className,
}: {
  /** Descrizione per chi naviga da tastiera o con screen reader. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // Congedo con grazia: attraversare lo spazio tra l'icona e il pannello non deve
  // farlo sparire in faccia.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Posizionamento: sotto l'icona, rientrato se sborderebbe dallo schermo.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = panel?.width ?? 320;
    const height = panel?.height ?? 240;
    let x = anchor.right - width;
    let y = anchor.bottom + 6;
    if (x < 8) x = 8;
    if (y + height > window.innerHeight - 8) y = Math.max(8, anchor.top - height - 6);
    setPos({ x, y });
  }, [open]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      // Sulle card della bacheca il puntatore avvia il trascinamento: senza
      // questo, partire dall'icona trascinerebbe il task invece di aprire il
      // pannello (stessa accortezza della spunta e della × in sequenza).
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        // L'icona vive dentro righe cliccabili: il clic apre il pannello, non il task.
        event.stopPropagation();
        cancelClose();
        setOpen((v) => !v);
      }}
      onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setOpen((v) => !v);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={label}
      aria-expanded={open}
    >
      {trigger}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
            className={cn(
              "fixed z-50 max-h-80 w-80 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg",
              className,
            )}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
