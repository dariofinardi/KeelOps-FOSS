// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import type { TaskDetail } from "@kancrm/shared";
import { formatDate } from "@/features/tasks/task-utils";
import { useUpdateTask } from "@/features/tasks/useTasks";
import { useMeetings } from "./useMeetings";

/** Etichetta di un incontro nell'elenco: titolo e data, quando c'è. */
function meetingLabel(title: string, dueDate: string | null): string {
  return dueDate ? `${formatDate(dueDate)} — ${title}` : title;
}

/**
 * Incontro in cui il task è stato deciso. Non è dove viene ridiscusso: quello sta
 * sulle singole note (Comment.meetingId), perché un'attività torna in più riunioni.
 */
export function TaskMeetingLink({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const { data: meetings } = useMeetings();
  const update = useUpdateTask();

  // Nessun incontro registrato e task non collegato: niente da mostrare, il campo
  // comparirà da sé quando esisterà almeno una riunione.
  if (!task.meeting && (meetings?.length ?? 0) === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
      <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{t("Deciso nell'incontro")}</span>
      <Combobox
        className="min-w-40 flex-1"
        value={task.meeting?.id ?? null}
        onChange={(meetingId) => update.mutate({ id: task.id, meetingId })}
        // L'incontro collegato potrebbe non essere tra i 100 più recenti dell'elenco.
        items={[
          ...(task.meeting && !meetings?.some((m) => m.id === task.meeting!.id)
            ? [
                {
                  id: task.meeting.id,
                  label: meetingLabel(task.meeting.title, task.meeting.dueDate),
                },
              ]
            : []),
          ...(meetings ?? []).map((meeting) => ({
            id: meeting.id,
            label: meetingLabel(meeting.title, meeting.dueDate),
          })),
        ]}
        placeholder={t("Cerca un incontro…")}
        emptyLabel={t("Nessuno")}
      />
    </div>
  );
}
