import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ActivityCategory, isRichTextEmpty, statusCategoryOf } from "@kancrm/shared";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField, TimeField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { isDirtyForm, useSaveOrDiscard } from "@/lib/unsaved-changes";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/features/auth/useAuth";
import { UserSelect } from "./UserSelect";
import { useDeals } from "@/features/deals/useDeals";
import { FolderKanban } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { DescriptionField } from "@/components/ui/rich-text/DescriptionField";
import { DealCombobox } from "@/features/deals/DealCombobox";
import { ActivityTypeSelect, useActivityTypes } from "./activity-types";
import { useOptions } from "@/features/options/useOptions";
import { useAttachmentStaging } from "./AttachmentStaging";
import { useCreateTask, useTaskStatuses } from "./useTasks";

type TaskContext = "personal" | "project" | "deal";

/**
 * Dialog "nuovo task" con selettore di contesto: personale (solo mio), in un
 * progetto (visibile ai membri) o collegato a un'offerta. I campi disponibili si
 * adattano ai permessi dell'utente. Usato dallo Scadenzario e dal quick-add globale.
 */
export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const saveOrDiscard = useSaveOrDiscard();
  const currentUser = useCurrentUser();
  const createTask = useCreateTask();
  const toast = useToast();
  const attachments = useAttachmentStaging();
  const [busy, setBusy] = useState(false);
  const { data: allStatuses } = useTaskStatuses();
  const dealsData = useDeals({ includeClosed: false, pageSize: 200 }, currentUser.canSeeDeals).data;
  const deals = currentUser.canSeeDeals ? (dealsData?.items ?? []) : [];

  const [title, setTitle] = useState("");
  const [context, setContext] = useState<TaskContext>("personal");
  const [projectId, setProjectId] = useState("");
  const [relatedDealId, setRelatedDealId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [activityTypeId, setActivityTypeId] = useState("");
  // Un task nasce assegnato e supervisionato da chi lo crea (modificabile).
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [supervisorId, setSupervisorId] = useState(currentUser.id);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Tutte le tendine del modulo in una chiamata, già filtrate per ruolo e vista.
  const options = useOptions({
    module: context === "project" ? "PROJECT" : "ADMIN",
    projectId: context === "project" ? projectId : null,
  });
  const { users, projects, canAssignOthers, projectMembers: selectedProjectMembers } = options;

  // Gli stati dipendono dalla categoria del tipo di attività scelto: cambiando
  // tipo, uno stato di un'altra categoria non è più valido e torna al default.
  const { data: activityTypes } = useActivityTypes();
  const category = statusCategoryOf({
    activityType: (activityTypes ?? []).find((type) => type.id === activityTypeId) ?? null,
    // Senza tipo di attività conta il contesto: un task personale è dello scadenzario.
    kind: context === "project" ? "PROJECT" : "ADMIN",
  });
  const statuses = (allStatuses ?? []).filter((status) => status.category === category);
  if (statusId && !statuses.some((status) => status.id === statusId)) setStatusId("");

  const reset = () => {
    setTitle("");
    setContext("personal");
    setProjectId("");
    setRelatedDealId("");
    setStatusId("");
    setActivityTypeId("");
    setAssigneeId("");
    setSupervisorId("");
    setDueDate("");
    setDueTime("");
    setDescription("");
    setError(null);
    attachments.reset();
  };

  // Uscendo (Annulla, ✕, Esc) si sceglie: creare, o buttare via quel che si è scritto.
  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    if (context === "project" && !projectId) {
      setError(t("Scegli un progetto"));
      return;
    }
    if (context === "deal" && !relatedDealId) {
      setError(t("Scegli un'offerta"));
      return;
    }
    setBusy(true);
    try {
      const task = await createTask.mutateAsync({
        title,
        statusId: statusId || undefined,
        assigneeId: canAssignOthers ? assigneeId || null : null,
        // Senza il permesso di coinvolgere altri resti tu il referente: campo
        // omesso = default del server (chi crea), non "nessun supervisore".
        supervisorId: canAssignOthers ? supervisorId || null : undefined,
        dueDate: dueDate || null,
        dueTime: context === "deal" ? dueTime || null : null,
        description: isRichTextEmpty(description) ? null : description,
        projectId: context === "project" ? projectId : null,
        relatedDealId: context === "deal" ? relatedDealId : null,
        activityTypeId: activityTypeId || null,
      });
      // Carica gli allegati messi in coda sul task appena creato.
      if (attachments.hasStaged) {
        const { failed } = await attachments.uploadTo(task.id);
        if (failed > 0) toast(t("{{count}} allegati non caricati", { count: failed }), "error");
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Errore imprevisto"));
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () =>
    saveOrDiscard({
      isDirty: isDirtyForm([
        [title, ""],
        // L'editor lascia un paragrafo vuoto: non è roba scritta.
        [isRichTextEmpty(description) ? "" : description, ""],
        [dueDate, ""],
        [dueTime, ""],
        [projectId, ""],
        [relatedDealId, ""],
      ]),
      canSave: title.trim() !== "" && statusId !== "",
      what: t("il nuovo task"),
      onSave: () => void onSubmit(),
      onDiscard: onClose,
    });

  const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
  // Le opzioni di contesto disponibili dipendono da progetti/offerte dell'utente.
  const contextOptions: Array<{ value: TaskContext; label: string; show: boolean }> = [
    { value: "personal", label: t("Personale (solo mio)"), show: true },
    {
      value: "project",
      label: t("In un progetto (visibile ai membri)"),
      show: projects.length > 0,
    },
    { value: "deal", label: t("Collegato a un'offerta"), show: deals.length > 0 },
  ];

  return (
    <Dialog open={open} onClose={requestClose} title={t("Nuovo task")}>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-title" importance="required">
            {t("Titolo")}
          </Label>
          <Input
            id="task-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {contextOptions.filter((o) => o.show).length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Contesto")}</Label>
            <div className="flex flex-col gap-1">
              {contextOptions
                .filter((o) => o.show)
                .map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="task-context"
                      checked={context === o.value}
                      onChange={() => setContext(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
            </div>
          </div>
        )}

        {context === "project" && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Progetto")}</Label>
            <Combobox
              value={projectId || null}
              onChange={(id) => setProjectId(id ?? "")}
              items={projects.map((p) => ({ id: p.id, label: p.name }))}
              placeholder={t("Cerca un progetto…")}
              icon={<FolderKanban className="size-4 shrink-0 text-muted-foreground" />}
            />
          </div>
        )}

        {context === "deal" && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("Offerta")}</Label>
            <DealCombobox
              value={relatedDealId || null}
              onChange={(id) => setRelatedDealId(id ?? "")}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-status" importance="required">
              {t("Stato")}
            </Label>
            <select
              id="task-status"
              className={selectClass}
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              <option value="">{t("Primo stato")}</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due" importance="recommended">
              {t("Scadenza")}
            </Label>
            <div className="flex gap-2">
              <DateField
                id="task-due"
                value={dueDate}
                onCommit={(v) => {
                  setDueDate(v ?? "");
                  if (!v) setDueTime("");
                }}
              />
              {/* Su telefonate e appuntamenti di un'offerta l'ora conta: campo
                  facoltativo, e senza data non ha senso. */}
              {context === "deal" && (
                <TimeField
                  className="w-32"
                  aria-label={t("Orario (facoltativo)")}
                  title={t("Orario (facoltativo)")}
                  disabled={!dueDate}
                  value={dueTime}
                  onCommit={(v) => setDueTime(v ?? "")}
                />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label importance="recommended">{t("Tipo di attività")}</Label>
            {/* Collegato a un'offerta = attività commerciale; negli altri casi
                decide il modulo in cui il task andrà a vivere. */}
            <ActivityTypeSelect
              kind={context === "project" ? "PROJECT" : "ADMIN"}
              category={context === "deal" ? ActivityCategory.SALES : undefined}
              value={activityTypeId}
              onChange={setActivityTypeId}
            />
          </div>
          {canAssignOthers && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-assignee" importance="recommended">
                  {t("Assegnatario")}
                </Label>
                <UserSelect
                  id="task-assignee"
                  value={assigneeId}
                  onChange={setAssigneeId}
                  users={users}
                  projectMembers={selectedProjectMembers}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-supervisor" importance="recommended">
                  {t("Supervisore")}
                </Label>
                <UserSelect
                  id="task-supervisor"
                  value={supervisorId}
                  onChange={setSupervisorId}
                  users={users}
                  projectMembers={selectedProjectMembers}
                  title={t("Riceve le notifiche su cambi di stato e commenti")}
                />
              </div>
            </>
          )}
        </div>
        <DescriptionField
          pendingImages
          value={description}
          onChange={setDescription}
          dialogTitle={t("Descrizione del nuovo task")}
        />
        {attachments.node}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("Creazione…") : t("Crea task")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
