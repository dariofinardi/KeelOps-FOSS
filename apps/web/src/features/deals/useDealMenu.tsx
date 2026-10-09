import { useState, type FormEvent } from "react";
import { Combobox } from "@/components/ui/combobox";
import { useTranslation } from "react-i18next";
import { ListTodo, SquarePen, Trash2 } from "lucide-react";
import { ActivityCategory, type DealListItem } from "@kancrm/shared";
import type { ContextMenuItem } from "@/components/ui/context-menu";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField, TimeField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/features/auth/useAuth";
import { ActivityTypeSelect } from "@/features/tasks/activity-types";
import { useAttachmentStaging } from "@/features/tasks/AttachmentStaging";
import { useCreateTask } from "@/features/tasks/useTasks";
import { useOptions } from "@/features/options/useOptions";
import { useDeleteDeal } from "./useDeals";

/**
 * Azioni del menu contestuale di un'offerta (apri, aggiungi task collegato,
 * elimina), condivise tra vista tabella e pipeline. Ritorna il builder delle
 * voci e il nodo del dialog "nuovo task collegato" da renderizzare una volta.
 */
export function useDealMenu(onOpen: (id: string) => void) {
  const { t } = useTranslation();
  const deleteDeal = useDeleteDeal();
  const confirm = useConfirm();
  const [quickTaskDeal, setQuickTaskDeal] = useState<DealListItem | null>(null);

  const items = (deal: DealListItem): ContextMenuItem[] => {
    const list: ContextMenuItem[] = [
      { label: t("Apri"), icon: <SquarePen className="size-4" />, onSelect: () => onOpen(deal.id) },
      {
        label: t("Aggiungi task"),
        icon: <ListTodo className="size-4" />,
        onSelect: () => setQuickTaskDeal(deal),
      },
    ];
    if (deal.canEdit) {
      list.push({
        label: t("Elimina"),
        icon: <Trash2 className="size-4" />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          void confirm({
            title: t("Eliminare l'offerta?"),
            message: t('"{{title}}" verrà spostata nel cestino.', { title: deal.title }),
            confirmLabel: t("Sposta nel cestino"),
            tone: "danger",
          }).then((ok) => {
            if (ok) deleteDeal.mutate(deal.id);
          });
        },
      });
    }
    return list;
  };

  const node = (
    <QuickTaskForDealDialog deal={quickTaskDeal} onClose={() => setQuickTaskDeal(null)} />
  );

  /** Apre il «nuovo task collegato» per un'offerta: serve anche fuori dal menu. */
  const aggiungiTask = (deal: DealListItem) => setQuickTaskDeal(deal);

  return { items, node, aggiungiTask };
}

/** Crea al volo un task dello scadenzario collegato a un'offerta. */
function QuickTaskForDealDialog({
  deal,
  onClose,
}: {
  deal: DealListItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createTask = useCreateTask();
  const toast = useToast();
  const attachments = useAttachmentStaging();
  const currentUser = useCurrentUser();
  const { users } = useOptions({ module: "ADMIN" });
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [activityTypeId, setActivityTypeId] = useState("");
  // Un task nato da un'offerta è di chi la segue: assegnato a sé, modificabile.
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setTitle("");
    setDueDate("");
    setActivityTypeId("");
    setAssigneeId(currentUser.id);
    attachments.reset();
    onClose();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!deal || title.trim() === "") return;
    setBusy(true);
    try {
      const task = await createTask.mutateAsync({
        title: title.trim(),
        dueDate: dueDate || null,
        dueTime: dueTime || null,
        relatedDealId: deal.id,
        activityTypeId: activityTypeId || null,
        assigneeId: assigneeId || null,
      });
      // Carica gli allegati messi in coda sul task appena creato.
      if (attachments.hasStaged) {
        const { failed } = await attachments.uploadTo(task.id);
        if (failed > 0) toast(t("{{count}} allegati non caricati", { count: failed }), "error");
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={deal !== null} onClose={close} title={t("Nuovo task collegato all'offerta")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("Il task entra nel tuo scadenzario (personale) collegato a")}{" "}
          <span className="font-medium text-foreground">{deal?.title}</span>.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-task-title">{t("Cosa c'è da fare?")}</Label>
          <Input
            id="quick-task-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quick-task-due">{t("Scadenza (facoltativa)")}</Label>
            <div className="flex gap-2">
              <DateField
                id="quick-task-due"
                className="w-44"
                value={dueDate}
                onCommit={(v) => {
                  setDueDate(v ?? "");
                  if (!v) setDueTime("");
                }}
              />
              <TimeField
                className="w-28"
                aria-label={t("Orario (facoltativo)")}
                title={t("Orario (facoltativo)")}
                disabled={!dueDate}
                value={dueTime}
                onCommit={(v) => setDueTime(v ?? "")}
              />
            </div>
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="quick-task-type">{t("Tipo di attività")}</Label>
            {/* Nasce da un'offerta: l'attività è commerciale (chiamata, follow-up),
                anche se il task vive nello scadenzario personale. */}
            <ActivityTypeSelect
              category={ActivityCategory.SALES}
              value={activityTypeId}
              onChange={setActivityTypeId}
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="quick-task-assignee">{t("Assegnato a")}</Label>
            <Combobox
              id="quick-task-assignee"
              value={assigneeId || null}
              onChange={(id) => setAssigneeId(id ?? "")}
              items={(users ?? []).map((user) => ({
                id: user.id,
                label:
                  user.id === currentUser.id ? t("{{name}} (io)", { name: user.name }) : user.name,
              }))}
              emptyLabel={t("Non assegnato")}
              placeholder={t("Cerca una persona…")}
            />
          </div>
        </div>
        {attachments.node}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t("Annulla")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("Creazione…") : t("Aggiungi task")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
