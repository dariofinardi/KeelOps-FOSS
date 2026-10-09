import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useFocusTrap } from "@/lib/focus-trap";
import { useEscapeToClose } from "@/lib/useEscapeToClose";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl";

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
  "2xl": "max-w-4xl",
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Larghezza massima del dialog. Default "md". */
  size?: DialogSize;
  /**
   * Altezza fissa alta (85vh) con il corpo che riempie invece di crescere col
   * contenuto: serve quando dentro c'è un'area che scorre da sé (l'editor a
   * schermo intero). Il corpo diventa una colonna flex che non scorre — lo fa
   * ciò che gli sta dentro.
   */
  fullHeight?: boolean;
}

export function Dialog({ open, onClose, title, children, size = "md", fullHeight }: DialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const trapRef = useFocusTrap(open);
  // Pila condivisa con i pannelli laterali: Esc chiude l'ultimo aperto.
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "flex w-full flex-col rounded-lg border bg-card text-card-foreground shadow-lg outline-none",
          fullHeight ? "h-[85vh]" : "max-h-[90vh]",
          SIZE_CLASS[size],
        )}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("Chiudi")}>
            <X className="size-4" />
          </Button>
        </div>
        {/* A altezza fissa il corpo riempie e non scorre (lo fa il contenuto);
            altrimenti scorre solo se supera l'altezza disponibile. */}
        <div
          className={cn(
            "px-6 pb-6",
            fullHeight ? "flex min-h-0 flex-1 flex-col gap-3" : "overflow-y-auto",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
