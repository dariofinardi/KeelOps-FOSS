// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import type { TaskListItem } from "@kancrm/shared";
import { InlineSelect } from "@/components/ui/inline-select";
import { useUsers } from "@/features/users/useUsers";
import { StatusBadge } from "./StatusBadge";
import { ActivityTypeBadge, groupActivityTypes, useActivityTypes } from "./activity-types";
import { useStatusesFor, useUpdateTaskWithSequenceConfirm } from "./useTasks";

/**
 * Celle dello scadenzario modificabili al click: stato, assegnatario e tipo attività
 * si cambiano direttamente dalla lista, senza aprire il dettaglio.
 *
 * Passano tutte da `mutateWithConfirm`, così restano attive le conferme di sequenza e
 * subtask (409) e il toast con la prossima scadenza dei task ricorrenti.
 */

export function TaskStatusCell({ task }: { task: TaskListItem }) {
  const { t } = useTranslation();
  // Gli stati proposti sono quelli della categoria del tipo di attività del task.
  const statuses = useStatusesFor(task);
  const update = useUpdateTaskWithSequenceConfirm();

  return (
    <InlineSelect
      value={task.status.id}
      title={t("Cambia stato")}
      options={statuses.map((s) => ({ value: s.id, label: s.name }))}
      onChange={(statusId) => update.mutateWithConfirm({ id: task.id, statusId })}
    >
      <StatusBadge status={task.status} />
    </InlineSelect>
  );
}

export function TaskAssigneeCell({
  task,
  className = "text-xs text-muted-foreground underline-offset-2 hover:underline",
}: {
  task: TaskListItem;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: users } = useUsers();
  const update = useUpdateTaskWithSequenceConfirm();

  return (
    <InlineSelect
      value={task.assignee?.id ?? null}
      title={t("Cambia assegnatario")}
      className={className}
      emptyLabel={t("Non assegnato")}
      options={(users ?? []).filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.name }))}
      onChange={(assigneeId) =>
        update.mutateWithConfirm({ id: task.id, assigneeId: assigneeId || null })
      }
    >
      {task.assignee?.name ?? <span className="italic">{t("Non assegnato")}</span>}
    </InlineSelect>
  );
}

export function TaskActivityTypeCell({ task }: { task: TaskListItem }) {
  const { t } = useTranslation();
  const { data: types } = useActivityTypes();
  const update = useUpdateTaskWithSequenceConfirm();

  return (
    <InlineSelect
      value={task.activityType?.id ?? null}
      title={t("Cambia tipo di attività")}
      emptyLabel={t("Nessun tipo")}
      // Stessi gruppi della tendina del dettaglio: i tipi del modulo più i
      // Generali, sotto l'intestazione della categoria.
      groups={groupActivityTypes(types, { value: task.activityType?.id, kind: task.kind }).map(
        (group) => ({
          label: t(group.label),
          options: group.items.map((t) => ({ value: t.id, label: t.name })),
        }),
      )}
      onChange={(activityTypeId) =>
        update.mutateWithConfirm({ id: task.id, activityTypeId: activityTypeId || null })
      }
    >
      {task.activityType ? (
        <ActivityTypeBadge type={task.activityType} />
      ) : (
        <span className="text-xs italic text-muted-foreground">{t("Nessun tipo")}</span>
      )}
    </InlineSelect>
  );
}
