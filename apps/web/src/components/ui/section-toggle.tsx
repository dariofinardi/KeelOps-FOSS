import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * L'intestazione di una sezione che si apre e si chiude.
 *
 * Unico punto, perché la regola non è solo grafica: **tutta l'intestazione è il
 * bersaglio**, non una freccetta da centrare — soprattutto col pollice — e da
 * chiusa la barra resta leggibile, contatori compresi. Chi apre se lo ritrova
 * aperto, perché lo stato lo tiene chi la usa (in `useListPrefs`).
 *
 * La usano i riquadri della giornata e i gruppi dell'agenda: due elenchi lunghi
 * per costruzione, che senza si mangiano lo schermo.
 */
export function SectionToggle({
  open,
  onToggle,
  className,
  children,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={cn("flex min-w-0 items-center gap-1.5 text-left hover:opacity-80", className)}
      aria-expanded={open}
      title={open ? t("Chiudi la sezione") : t("Apri la sezione")}
      onClick={() => onToggle(!open)}
    >
      <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
      {children}
    </button>
  );
}
