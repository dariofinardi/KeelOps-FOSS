import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Repeat, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/features/tasks/task-utils";
import { RecurrenceForm } from "./RecurrenceForm";
import { useRecurrenceTemplates } from "./useRecurrence";

/**
 * Intestazione ricorrenza nel dettaglio di una singola occorrenza.
 *
 * Va vista al primo sguardo: senza, un task generato da una regola sembra un task
 * qualsiasi e non si capisce se modificarlo tocchi la serie. Il banner dice tre
 * cose — è ricorrente, si ripete così, e le modifiche qui valgono solo per questa
 * occorrenza — e nasconde dietro un pulsante la configurazione della SERIE, che
 * invece cambia tutte le occorrenze future.
 *
 * Il template arriva dalla lista già in cache, condivisa con la pagina Ricorrenze.
 */
export function TaskRecurrencePanel({
  templateId,
  onOccurrencesRegenerated,
}: {
  templateId: string;
  /**
   * Cambiando la pianificazione le occorrenze future vengono **rigenerate**: il
   * task aperto qui sotto non esiste più, e continuare a modificarlo dà "task
   * non trovato" perdendo quello che si scrive (14/08/2026). Chi ci monta questo
   * pannello lo chiude.
   */
  onOccurrencesRegenerated?: () => void;
}) {
  const { t } = useTranslation();
  const { data: templates, isLoading } = useRecurrenceTemplates();
  const [open, setOpen] = useState(false);
  const template = templates?.find((t) => t.id === templateId);

  if (isLoading) {
    return (
      <div className="mb-4 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
        {t("Caricamento ricorrenza…")}
      </div>
    );
  }

  // Il template può essere stato eliminato lasciando in piedi le occorrenze già create.
  if (!template) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        <Repeat className="mt-0.5 size-4 shrink-0" />
        <span>
          {t("Era un'occorrenza di una ricorrenza")} <strong>{t("ora eliminata")}</strong>
          {t(": da qui è un task normale, modificarlo non influisce su altro.")}
        </span>
      </div>
    );
  }

  return (
    <section className="mb-4 rounded-md border border-violet-500/30 bg-violet-500/10 text-sm">
      <div className="flex flex-col gap-1 px-3 py-2">
        <div className="flex items-center gap-2 font-medium text-violet-700 dark:text-violet-300">
          <Repeat className="size-4 shrink-0" />
          <span className="flex-1">
            {t("Task ricorrente · si ripete")}{" "}
            <span className="font-semibold">{template.ruleText}</span>
          </span>
          {!template.isActive && <Badge variant="outline">{t("Sospesa")}</Badge>}
        </div>
        <p className="pl-6 text-xs text-muted-foreground">
          {t("Stato, scadenza, assegnatario e note qui sotto valgono")}{" "}
          <strong>{t("solo per questa scadenza")}</strong>
          {t(": la ricorrenza continua. Prossime:")}{" "}
          {template.nextOccurrences.map(formatDate).join(", ") || t("nessuna")}.
        </p>
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-2 border-t border-violet-500/20 px-3 py-2 text-left text-xs text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <span className="flex-1 font-medium">
          {open
            ? t("Chiudi le impostazioni della serie")
            : t("Configura la serie (tutte le occorrenze future)")}
        </span>
      </button>

      {open && (
        <div className="border-t border-violet-500/20 p-3">
          <p className="mb-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("Queste impostazioni valgono per")}{" "}
              <strong>{t("tutte le occorrenze future")}</strong>{" "}
              {t(
                "non ancora lavorate, non per il task qui aperto. Modificando la pianificazione, le occorrenze future vengono rigenerate.",
              )}
            </span>
          </p>
          <RecurrenceForm
            template={template}
            seriesLabels
            onSaved={(saved) => {
              setOpen(false);
              if (saved.occurrencesRegenerated) onOccurrencesRegenerated?.();
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
