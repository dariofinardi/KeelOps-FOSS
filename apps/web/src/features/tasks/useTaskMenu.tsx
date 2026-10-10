// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { CheckCircle2, Copy, RotateCcw, SquarePen, Trash2, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { statusCategoryOf, TaskKind, type TaskListItem } from "@kancrm/shared";
import type { ContextMenuItem } from "@/components/ui/context-menu";
import { useConfirm } from "@/components/ui/confirm";
import { useCurrentUser } from "@/features/auth/useAuth";
import {
  useDeleteTask,
  useDuplicateTask,
  useTaskStatuses,
  useUpdateTaskWithSequenceConfirm,
} from "./useTasks";
import { AREAS } from "@/components/layout/areas";
import { useCreateDealFromTaskCommand } from "@/features/deals/deal-from-task-context";

/**
 * Costruisce le voci del menu contestuale per un task dello scadenzario:
 * apri, assegna a me, completa/riapri, duplica, elimina. Le mutazioni gestiscono da sole
 * le conferme di sequenza/subtask (409).
 */
export function useTaskMenuItems(onOpen: (id: string) => void) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const { data: statuses } = useTaskStatuses();
  const update = useUpdateTaskWithSequenceConfirm();
  const deleteTask = useDeleteTask();
  const duplicate = useDuplicateTask();
  const confirm = useConfirm();
  const creaOfferta = useCreateDealFromTaskCommand();

  return (task: TaskListItem): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: t("Apri"), icon: <SquarePen className="size-4" />, onSelect: () => onOpen(task.id) },
    ];

    // Lo stesso comando del pannello (regola 6): un'offerta da questo task.
    if (creaOfferta && task.kind !== TaskKind.DEAL) {
      items.push({
        label: t("Crea offerta da questo task"),
        icon: <AREAS.deals.icon className="size-4" />,
        onSelect: () => creaOfferta(task.id),
      });
    }

    if (task.assignee?.id !== currentUser.id) {
      items.push({
        label: t("Assegna a me"),
        icon: <UserCheck className="size-4" />,
        onSelect: () => update.mutateWithConfirm({ id: task.id, assigneeId: currentUser.id }),
      });
    }

    // Gli stati sono per categoria: prendi quelli del tipo di attività del task.
    const category = statusCategoryOf(task);
    const inCategory = (statuses ?? []).filter((s) => s.category === category);
    const closedStatus = inCategory.find((s) => s.isClosed);
    const openStatus = inCategory.find((s) => !s.isClosed);
    if (!task.status.isClosed && closedStatus) {
      items.push({
        // Su un'occorrenza ricorrente il server crea la scadenza successiva e la
        // mostra nel toast di conferma (vedi useUpdateTask).
        label: t("Completata"),
        icon: <CheckCircle2 className="size-4" />,
        onSelect: () => update.mutateWithConfirm({ id: task.id, statusId: closedStatus.id }),
      });
    } else if (task.status.isClosed && openStatus) {
      items.push({
        label: t("Riapri"),
        icon: <RotateCcw className="size-4" />,
        onSelect: () => update.mutateWithConfirm({ id: task.id, statusId: openStatus.id }),
      });
    }

    // Duplicare è una modifica del contenitore, non del task: si offre a chi
    // potrebbe modificarlo, che è la stessa condizione che il server verifica.
    // Della copia si prende la definizione, non la storia — commenti, registro
    // e ore restano dell'originale.
    if (task.canEdit) {
      items.push({
        label: t("Duplica"),
        icon: <Copy className="size-4" />,
        onSelect: () => duplicate.mutate(task.id),
      });
    }

    // Il comando compare solo se il server lo accetterebbe: prima era sempre in
    // elenco e per molti finiva in un rifiuto.
    if (task.canDelete) {
      items.push({
        label: t("Elimina"),
        icon: <Trash2 className="size-4" />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          void confirm({
            title: t("Eliminare il task?"),
            message: t('"{{title}}" verrà spostato nel cestino.', { title: task.title }),
            confirmLabel: t("Sposta nel cestino"),
            tone: "danger",
          }).then((ok) => {
            if (ok) deleteTask.mutate(task.id);
          });
        },
      });
    }

    return items;
  };
}
