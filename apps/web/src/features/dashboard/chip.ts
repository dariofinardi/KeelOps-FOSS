import { cn } from "@/lib/utils";

/**
 * **La pastiglia del riepilogo**: due contatori che sono anche il filtro — si
 * guarda una lista alla volta, e il numero dice cosa c'è nell'altra.
 *
 * Sta qui e non dentro un componente perché ora la usano in due (i task e le
 * offerte), ed è il modo in cui questa pagina fa questa domanda: metterci una
 * tendina accanto vorrebbe dire due modi per la stessa cosa nella stessa
 * schermata (04/09/2026).
 */
export const chipRiepilogo = (attiva: boolean): string =>
  cn(
    "rounded-full border px-2 py-0.5 text-xs transition-colors",
    attiva
      ? "border-primary bg-primary/10 font-semibold text-primary"
      : "text-muted-foreground hover:bg-muted/60",
  );
