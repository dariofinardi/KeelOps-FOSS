import { useState } from "react";
import { useListPrefs } from "@/lib/useListPrefs";
import { FilterSelect } from "@/components/ui/filter-select";
import { useTranslation } from "react-i18next";
import { CalendarRange, Link2, List, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import type { RecurrenceTemplate } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatDate } from "@/features/tasks/task-utils";
import { RecurrenceCalendar } from "./RecurrenceCalendar";
import { RecurrenceForm } from "./RecurrenceForm";
import { useDeleteTemplate, useRecurrenceTemplates } from "./useRecurrence";

export function TemplatesView({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
  const { t } = useTranslation();
  const { data: templates, isLoading } = useRecurrenceTemplates();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RecurrenceTemplate | null>(null);
  const [deleting, setDeleting] = useState<RecurrenceTemplate | null>(null);
  const [mode, setMode] = useState<"list" | "calendar">(
    () => (localStorage.getItem("kancrm.recurrence.mode") as "list" | "calendar" | null) ?? "list",
  );

  /**
   * **Filtro attive / sospese.** Sospendere una ricorrenza toglie dallo
   * scadenzario le occorrenze future non ancora lavorate: il task sparisce, e
   * la ricorrenza resta qui — ma in fondo a un elenco che qui dentro è di
   * novanta voci, perché senza occorrenze future si ordina per ultima. Trovarla
   * per riattivarla era una caccia (19/08/2026). Il conteggio sta
   * nell'etichetta, così le sospese non sono mai invisibili.
   */
  const { prefs, update } = useListPrefs("kancrm-recurrence-filters", {
    stato: "tutte" as "tutte" | "attive" | "sospese",
  });
  const attive = (templates ?? []).filter((tpl) => tpl.isActive).length;
  const sospese = (templates ?? []).length - attive;
  const visibili = (templates ?? []).filter((tpl) =>
    prefs.stato === "tutte" ? true : prefs.stato === "attive" ? tpl.isActive : !tpl.isActive,
  );

  const changeMode = (next: "list" | "calendar") => {
    setMode(next);
    localStorage.setItem("kancrm.recurrence.mode", next);
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Caricamento ricorrenze…")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* `ml-auto` sul pulsante, non `justify-between` sulla riga: quando la
          barra va a capo (telefono) `justify-between` lascia il pulsante da
          solo sulla sua riga e lo spinge a SINISTRA, mentre in ogni altra vista
          "Nuovo…" sta a destra. Un comando che cambia angolo a seconda della
          vista si cerca due volte (17/08/2026). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border p-0.5">
            <Button
              variant={mode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => changeMode("list")}
            >
              <List className="size-4" /> {t("Elenco")}
            </Button>
            <Button
              variant={mode === "calendar" ? "default" : "ghost"}
              size="sm"
              onClick={() => changeMode("calendar")}
            >
              <CalendarRange className="size-4" /> {t("Calendario")}
            </Button>
          </div>
          {mode === "list" && (
            <FilterSelect
              icon="status"
              label={t("Stato")}
              value={prefs.stato}
              onChange={(value) => update({ stato: value as typeof prefs.stato })}
            >
              <option value="tutte">{t("Tutte ({{n}})", { n: templates?.length ?? 0 })}</option>
              <option value="attive">{t("Attive ({{n}})", { n: attive })}</option>
              <option value="sospese">{t("Sospese ({{n}})", { n: sospese })}</option>
            </FilterSelect>
          )}
          <p className="hidden text-sm text-muted-foreground lg:block">
            {mode === "list"
              ? t(
                  "Le ricorrenze generano automaticamente i task dello scadenzario fino a 60 giorni in anticipo (ogni notte e all'avvio).",
                )
              : t("Le scadenze ricorrenti della settimana corrente e delle tre successive.")}
          </p>
        </div>
        <Button
          className="ml-auto"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="size-4" /> {t("Nuova ricorrenza")}
        </Button>
      </div>

      {mode === "calendar" && <RecurrenceCalendar onOpenTask={onOpenTask} />}

      <div className={cn("grid gap-4 md:grid-cols-2", mode === "calendar" && "hidden")}>
        {visibili.map((template) => (
          <div key={template.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <Repeat className="size-4 text-muted-foreground" />
                  {template.title}
                  {!template.isActive && <Badge variant="outline">{t("Sospesa")}</Badge>}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("Si ripete {{ruleText}}.", { ruleText: template.ruleText })}
                </p>
              </div>
              {/* Modifica ed eliminazione solo a chi ha creato la ricorrenza (o a un
                  admin): il server rifiuta gli altri, e mostrare i pulsanti a tutti
                  faceva sembrare possibile eliminare le scadenze dei colleghi. */}
              {template.canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("Modifica")}
                    onClick={() => {
                      setEditing(template);
                      setEditorOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("Elimina")}
                    onClick={() => setDeleting(template)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Prossime:")} {template.nextOccurrences.map(formatDate).join(", ") || "—"}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {template.relatedDeal && (
                <span>{t("Offerta: {{name}}", { name: template.relatedDeal.name })}</span>
              )}
              {template.assignee && (
                <span>{t("Assegnatario: {{name}}", { name: template.assignee.name })}</span>
              )}
              {template.supervisor && (
                <span>{t("Supervisore: {{name}}", { name: template.supervisor.name })}</span>
              )}
              {template.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="size-3" />{" "}
                  {t("{{count}} allegati", { count: template.attachments.length })}
                </span>
              )}
            </div>
          </div>
        ))}
        {visibili.length === 0 && (templates?.length ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("Nessuna ricorrenza con questo filtro.")}
          </p>
        )}
        {(templates?.length ?? 0) === 0 && (
          <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t("Nessuna ricorrenza configurata.")}
          </div>
        )}
      </div>

      {editorOpen && (
        <TemplateEditorDialog template={editing} onClose={() => setEditorOpen(false)} />
      )}
      <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/** Dialog della pagina Ricorrenze: il form vive in RecurrenceForm, condiviso con
 * la sezione richiudibile del dettaglio task. */
export function TemplateEditorDialog({
  template,
  onClose,
}: {
  template: RecurrenceTemplate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={template ? t("Modifica ricorrenza") : t("Nuova ricorrenza")}
    >
      <RecurrenceForm template={template} onSaved={onClose} onCancel={onClose} />
    </Dialog>
  );
}

function DeleteTemplateDialog({
  template,
  onClose,
}: {
  template: RecurrenceTemplate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteTemplate = useDeleteTemplate();

  const run = (deleteFuture: boolean) => {
    if (!template) return;
    deleteTemplate.mutate({ id: template.id, deleteFuture }, { onSuccess: onClose });
  };

  return (
    <Dialog
      open={template !== null}
      onClose={onClose}
      title={t('Eliminare "{{title}}"?', { title: template?.title ?? "" })}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {t(
          "Vuoi eliminare anche i task futuri già generati e non ancora lavorati, o mantenerli nello scadenzario?",
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("Annulla")}
        </Button>
        <Button variant="outline" disabled={deleteTemplate.isPending} onClick={() => run(false)}>
          {t("Mantieni i task")}
        </Button>
        <Button variant="destructive" disabled={deleteTemplate.isPending} onClick={() => run(true)}>
          {t("Elimina anche i task futuri")}
        </Button>
      </div>
    </Dialog>
  );
}
