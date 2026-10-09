import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateTaskDetails, invalidateTaskLists } from "@/lib/invalidate";
import { clearPendingChanges, usePendingChanges } from "./pending-changes";

/**
 * "Qualcosa che hai davanti è cambiato."
 *
 * Un avviso, non un evento: **non succede niente finché non lo chiedi tu**.
 * Nessun elenco che si riordina da solo mentre lo stai leggendo, nessun campo
 * riscritto sotto le dita, nessuna tendina che si richiude a metà scelta.
 *
 * Dove sta e perché: **in basso al centro**, l'unica zona libera — i pannelli
 * si aprono a destra, i filtri stanno in alto, e gli avvisi di conferma
 * occupano l'angolo in basso a destra. Fluttua sopra la pagina senza spostarla
 * di un pixel: una barra che si infila in cima a un elenco fa scivolare tutto
 * e il clic che stavi per fare finisce sulla riga sbagliata.
 *
 * Non ruba il fuoco, non apre finestre, non lampeggia: `role="status"` con
 * lettura cortese, così chi usa un lettore di schermo lo sente quando si ferma,
 * non in mezzo a una parola. Se arrivano altri cambiamenti cresce solo il
 * numero.
 *
 * Premendo "Aggiorna" si rileggono elenchi e record aperti — non le tendine
 * (utenti, stati, tipi di attività): quelle cambiano di rado e ricaricarle
 * chiuderebbe una combo aperta. E ciò che si sta scrivendo resta: il valore che
 * torna dal server non sostituisce mai una bozza in corso (`useAutosaveText`).
 */
export function UpdatesToast() {
  const { t } = useTranslation();
  const pending = usePendingChanges();
  const queryClient = useQueryClient();

  if (pending.length === 0) return null;

  const refresh = () => {
    // Gli elenchi e i riepiloghi si invalidano UNA volta, non per record: erano
    // sette radici globali per ognuno, e con venti record in coda diventavano
    // centinaia di refetch cancellati a metà. I dettagli invece sono per-id.
    invalidateTaskLists(queryClient);
    for (const record of pending) invalidateTaskDetails(queryClient, record.id);
    clearPendingChanges();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card py-2 pl-4 pr-2 text-sm shadow-lg">
        <span className="text-muted-foreground">
          {t("{{count}} record aggiornati", { count: pending.length })}
        </span>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="size-3.5" /> {t("Aggiorna")}
        </button>
      </div>
    </div>
  );
}
