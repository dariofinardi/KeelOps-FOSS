import { useRef, useState, type FormEvent } from "react";
import { Combobox } from "@/components/ui/combobox";
import { todayISO } from "@/features/tasks/task-utils";
import { useTranslation } from "react-i18next";
import { Link2, Trash2, Upload } from "lucide-react";
import type { RecurrenceTemplate } from "@kancrm/shared";
import { ApiError, apiUpload } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleDriveGlyph } from "@/features/attachments/GoogleDriveGlyph";
import { slot } from "@/edition/slots";
import { useNessunSelettoreDrive } from "@/features/attachments/selettore-drive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTaskStatuses } from "@/features/tasks/useTasks";
import { DealCombobox } from "@/features/deals/DealCombobox";
import { ActivityTypeSelect } from "@/features/tasks/activity-types";
import { useOptions } from "@/features/options/useOptions";
import { RecurrenceBuilder } from "./RecurrenceBuilder";
import {
  useAddTemplateLink,
  useCreateTemplate,
  useDeleteTemplateAttachment,
  useUpdateTemplate,
} from "./useRecurrence";

interface RecurrenceFormProps {
  /** null = nuova ricorrenza. */
  template: RecurrenceTemplate | null;
  /**
   * Salvato. Riceve la ricorrenza come torna dal server: chi lo monta dentro un
   * task guarda `occurrencesRegenerated` per sapere se l'occorrenza che stava
   * mostrando esiste ancora.
   */
  onSaved: (saved: RecurrenceTemplate) => void;
  onCancel?: () => void;
  /**
   * Etichette con il suffisso "di serie". Serve quando il form vive accanto ai campi
   * di una singola occorrenza (dettaglio task): senza, ci si troverebbero due
   * "Assegnatario" adiacenti, uno per il task e uno per tutte le occorrenze future.
   */
  seriesLabels?: boolean;
}

/**
 * Campi di una ricorrenza, senza contenitore: la pagina Ricorrenze lo mostra dentro
 * un dialog, il dettaglio del task dentro una sezione richiudibile.
 */
export function RecurrenceForm({
  template,
  onSaved,
  onCancel,
  seriesLabels = false,
}: RecurrenceFormProps) {
  const { t } = useTranslation();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const addLink = useAddTemplateLink();
  const removeAttachment = useDeleteTemplateAttachment();
  const { users } = useOptions({ module: "ADMIN" });
  const { data: statuses } = useTaskStatuses();
  const adminStatuses = (statuses ?? []).filter((s) => s.category === "ADMIN");

  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(template?.assignee?.id ?? "");
  const [supervisorId, setSupervisorId] = useState(template?.supervisor?.id ?? "");
  const [activityTypeId, setActivityTypeId] = useState(template?.activityType?.id ?? "");
  const [relatedDealId, setRelatedDealId] = useState(template?.relatedDeal?.id ?? "");
  const [initialStatusId, setInitialStatusId] = useState(template?.initialStatus?.id ?? "");
  const [dtstart, setDtstart] = useState(template?.dtstart ?? todayISO());
  const [rrule, setRRule] = useState<string | null>(template?.rrule ?? null);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // The picker is the commercial `google` module: without it, no Drive button.
  const drive = (slot.useSelettoreDrive ?? useNessunSelettoreDrive)();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);

  /**
   * I documenti scelti su Drive diventano allegati **link**, dalla stessa rotta
   * dell'incolla-link: il server non parla mai con le API di Drive.
   */
  const pickFromDrive = async () => {
    if (!template) return;
    setError(null);
    try {
      for (const doc of await drive.open()) {
        await addLink.mutateAsync({ id: template.id, name: doc.name, url: doc.url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Selettore Drive non disponibile"));
    }
  };

  /** I file salgono uno per volta sulla rotta della ricorrenza, poi si ricarica. */
  const uploadFiles = async (files: FileList | File[]) => {
    if (!template) return;
    setError(null);
    setUploading(true);
    try {
      // `apiUpload` è il punto unico da cui sale un file: il messaggio
      // d'errore del server arriva intero, invece di ridiventare "fallito".
      for (const file of Array.from(files)) {
        await apiUpload(`/api/recurrence-templates/${template.id}/attachments/file`, file);
      }
      await queryClient.invalidateQueries({ queryKey: ["recurrence-templates"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Caricamento non riuscito"));
    } finally {
      setUploading(false);
    }
  };
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const pending = createTemplate.isPending || updateTemplate.isPending;
  const idPrefix = seriesLabels ? "series" : "tpl";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!rrule) {
      setError(t("Configura una regola di ricorrenza valida"));
      return;
    }
    const common = {
      title,
      description: description.trim() === "" ? null : description,
      assigneeId: assigneeId || null,
      supervisorId: supervisorId || null,
      activityTypeId: activityTypeId || null,
      relatedDealId: relatedDealId || null,
      initialStatusId: initialStatusId || null,
      rrule,
      dtstart,
    };
    const handlers = {
      onSuccess: (saved: RecurrenceTemplate) => onSaved(saved),
      onError: (err: Error) =>
        setError(err instanceof ApiError ? err.message : t("Errore imprevisto")),
    };
    if (template) {
      updateTemplate.mutate({ id: template.id, ...common, isActive }, handlers);
    } else {
      createTemplate.mutate(common, handlers);
    }
  };

  const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>
          {seriesLabels ? t("Titolo dei task generati") : t("Titolo del task generato")}
        </Label>
        <Input
          id={`${idPrefix}-title`}
          required
          autoFocus={!seriesLabels}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-assignee`}>
            {seriesLabels ? t("Assegnatario di serie") : t("Assegnatario")}
          </Label>
          <Combobox
            id={`${idPrefix}-assignee`}
            value={assigneeId || null}
            onChange={(id) => setAssigneeId(id ?? "")}
            items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
            emptyLabel={t("Nessuno")}
            placeholder={t("Cerca una persona…")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-supervisor`}>
            {seriesLabels ? t("Supervisore di serie") : t("Supervisore")}
          </Label>
          <Combobox
            id={`${idPrefix}-supervisor`}
            value={supervisorId || null}
            onChange={(id) => setSupervisorId(id ?? "")}
            items={(users ?? []).map((user) => ({ id: user.id, label: user.name }))}
            emptyLabel={t("Nessuno")}
            placeholder={t("Cerca una persona…")}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>{seriesLabels ? t("Tipo di attività di serie") : t("Tipo di attività")}</Label>
          <ActivityTypeSelect kind="ADMIN" value={activityTypeId} onChange={setActivityTypeId} />
        </div>
        {/* Riferimento a un'offerta (es. il canone che nasce da una trattativa vinta):
            i task generati restano nello scadenzario, con il rimando all'offerta. */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-deal`}>{t("Offerta di riferimento")}</Label>
          <DealCombobox
            value={relatedDealId || null}
            onChange={(id) => setRelatedDealId(id ?? "")}
            includeClosed
            placeholder={t("Cerca un'offerta…")}
          />
          <p className="text-xs text-muted-foreground">
            {t("I task generati restano nello scadenzario: l'offerta è solo un riferimento.")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-initial-status`}>
            {t("Stato iniziale delle occorrenze")}
          </Label>
          <select
            id={`${idPrefix}-initial-status`}
            className={selectClass}
            value={initialStatusId}
            onChange={(e) => setInitialStatusId(e.target.value)}
          >
            <option value="">{t("Predefinito (primo stato)")}</option>
            {adminStatuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <RecurrenceBuilder
        initialRRule={template?.rrule}
        dtstart={dtstart}
        onDtstartChange={setDtstart}
        onRRuleChange={setRRule}
      />
      {template && !seriesLabels && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Cambiando la pianificazione, le occorrenze future non ancora lavorate verranno rigenerate.",
          )}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>
          {seriesLabels ? t("Descrizione di serie") : t("Descrizione")}
        </Label>
        <textarea
          id={`${idPrefix}-description`}
          className="min-h-16 rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {template && (
        <>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              {t("Ricorrenza attiva")}
            </label>
            {/* Sospendere toglie dallo scadenzario le occorrenze future non
                ancora lavorate: il task **sparisce**, e senza dirlo sembra che
                sia sparita la ricorrenza (19/08/2026). Si dice qui, dove si
                decide, e si dice anche dove ritrovarla. */}
            {!isActive && (
              <p className="ml-6 text-xs text-amber-700 dark:text-amber-400">
                {t(
                  "Sospendendola, le occorrenze future non ancora lavorate spariscono dallo scadenzario. La ricorrenza resta in questo elenco, sotto il filtro «Sospese», e si può riattivare da qui.",
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Label>{t("Allegati-modello (collegati a ogni occorrenza)")}</Label>
            <ul className="flex flex-col gap-1">
              {template.attachments.map((attachment) => (
                <li key={attachment.id} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Link2 className="size-3.5 text-muted-foreground" /> {attachment.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("Rimuovi")}
                    onClick={() =>
                      removeAttachment.mutate({ id: template.id, attachmentId: attachment.id })
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {/* Gli stessi tre modi di un task: file, Drive, link incollato.
                  La rotta di upload esisteva già lato server — mancava solo il
                  comando (19/08/2026). */}
              {drive.enabled && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={addLink.isPending}
                  onClick={() => void pickFromDrive()}
                >
                  <GoogleDriveGlyph className="size-3.5" /> {t("Drive")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" /> {uploading ? t("Carico…") : t("File")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder={t("Titolo link")}
                className="min-w-32 flex-1"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
              />
              <Input
                placeholder="https://…"
                className="min-w-32 flex-1"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={addLink.isPending || !linkName || !linkUrl}
                onClick={() => {
                  addLink.mutate(
                    { id: template.id, name: linkName, url: linkUrl },
                    {
                      onSuccess: () => {
                        setLinkName("");
                        setLinkUrl("");
                      },
                      onError: (err) =>
                        setError(err instanceof ApiError ? err.message : t("Errore")),
                    },
                  );
                }}
              >
                {t("Aggiungi")}
              </Button>
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {t("Annulla")}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("Salvataggio…") : template ? t("Salva") : t("Crea ricorrenza")}
        </Button>
      </div>
    </form>
  );
}
