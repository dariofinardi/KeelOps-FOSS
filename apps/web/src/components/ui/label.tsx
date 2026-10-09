import type { LabelHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Quanto conta un campo, in tre gradini — la scala vale per tutti i pannelli e
 * le finestre dell'applicazione, così un colore dice la stessa cosa ovunque:
 *
 * - **required**: senza questo dato il record non sta in piedi (pallino color
 *   primario, il viola dell'applicazione);
 * - **recommended**: si può salvare senza, ma chi lo compila fa lavorare meglio
 *   tutti — scadenze, assegnatari, tipi (pallino azzurro);
 * - **optional** (predefinito): nessun segno, resta il bordo grigio di sempre.
 *
 * Il segno sta sull'etichetta e non sul campo: i campi hanno forme diverse
 * (testo, tendine, combo, date) e colorarne i bordi uno a uno produrrebbe
 * incoerenze; l'etichetta è uguale dappertutto. Il tooltip spiega il pallino a
 * chi lo incontra la prima volta.
 */
export type FieldImportance = "required" | "recommended" | "optional";

const IMPORTANCE_META: Record<
  Exclude<FieldImportance, "optional">,
  { dot: string; hint: string }
> = {
  required: { dot: "bg-primary", hint: "Campo necessario" },
  recommended: { dot: "bg-sky-400", hint: "Consigliato: aiuta chi lavora dopo di te" },
};

export function Label({
  className,
  importance = "optional",
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { importance?: FieldImportance }) {
  const { t } = useTranslation();
  const meta = importance !== "optional" ? IMPORTANCE_META[importance] : null;
  return (
    <label className={cn("text-sm font-medium leading-none text-foreground", className)} {...props}>
      {children}
      {meta && (
        <span
          className={cn("ml-1.5 inline-block size-1.5 rounded-full align-middle", meta.dot)}
          title={t(meta.hint)}
          aria-label={t(meta.hint)}
        />
      )}
    </label>
  );
}
