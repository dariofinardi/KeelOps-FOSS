import { useEffect, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

export interface ViewOption<T extends string> {
  value: T;
  /**
   * L'etichetta **in italiano**, che è la chiave dei cataloghi: la traduzione
   * la fa questo componente, non le pagine. Prima ognuna la scriveva a mano nel
   * suo elenco di viste e nessuna la passava da `t()`, così «I task» e
   * «L'andamento» restavano in italiano anche con l'interfaccia in inglese —
   * in cinque aree diverse, tutte per lo stesso motivo.
   */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Tasto che porta a questa vista (una lettera, senza modificatori). */
  key: string;
}

/** true se si sta scrivendo: le scorciatoie a lettera singola non devono rubare i tasti. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Scorciatoie di cambio vista: una lettera per vista, ignorate mentre si scrive
 * o con Ctrl/Alt/Cmd premuti. Sta qui e non nelle pagine perché ogni modulo con
 * più viste deve comportarsi allo stesso modo — prima le aveva solo lo
 * Scadenzario, e chi le imparava lì le trovava mute altrove.
 */
export function useViewShortcuts<T extends string>(
  options: Array<ViewOption<T>>,
  onChange: (value: T) => void,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const match = options.find((o) => o.key.toLowerCase() === event.key.toLowerCase());
      if (match) onChange(match.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Le opzioni sono costanti di modulo; onChange cambia a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Selettore di vista: lo stesso gruppo di bottoni in tutti i moduli, con la
 * scorciatoia scritta nel suggerimento — una scorciatoia che non si vede da
 * nessuna parte non la usa nessuno.
 */
export function ViewSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<ViewOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  useViewShortcuts(options, onChange);
  return (
    // `flex-wrap`: quattro viste con l'etichetta non stanno in 390px, e un
    // selettore che sborda porta con sé tutta la pagina (16/08/2026).
    <div className="flex flex-wrap rounded-md border p-0.5">
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "default" : "ghost"}
          size="sm"
          title={`${t(option.label)} (${option.key.toUpperCase()})`}
          onClick={() => onChange(option.value)}
        >
          <option.icon className="size-4" /> {t(option.label)}
        </Button>
      ))}
    </div>
  );
}
