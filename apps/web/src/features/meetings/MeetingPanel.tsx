// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, ChevronDown, ChevronRight, Users } from "lucide-react";
import type { TaskDetail } from "@kancrm/shared";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PeopleInput } from "@/components/ui/people-input";
import { formatDate } from "@/features/tasks/task-utils";
import { useUpdateTask } from "@/features/tasks/useTasks";
import { useMeetingMinutes, usePeopleSuggestions } from "./useMeetings";

/**
 * Pannello mostrato quando il task aperto è un incontro: presenti e verbale.
 *
 * Il verbale raccoglie le note prese durante la riunione sulle altre attività
 * (Comment.meetingId), raggruppate per attività: è la lettura "per colonna" della
 * matrice attività × riunioni.
 */
export function MeetingPanel({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const update = useUpdateTask();
  const suggestions = usePeopleSuggestions();
  const [participants, setParticipants] = useState(task.participants ?? "");
  const [dirty, setDirty] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(true);
  const { data: minutes, isLoading } = useMeetingMinutes(task.id);

  const save = () => {
    if (!dirty) return;
    update.mutate({ id: task.id, participants: participants.trim() || null });
    setDirty(false);
  };

  const noteCount = minutes?.groups.reduce((sum, g) => sum + g.notes.length, 0) ?? 0;

  return (
    <section className="mb-4 flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 text-primary" />
        {t("Incontro")}
        {task.dueDate && (
          <span className="font-normal text-muted-foreground">
            {t("del {{date}}", { date: formatDate(task.dueDate) })}
          </span>
        )}
      </h3>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="meeting-participants" className="flex items-center gap-1.5">
          <Users className="size-3.5" /> {t("Presenti")}
        </Label>
        <PeopleInput
          id="meeting-participants"
          value={participants}
          suggestions={suggestions}
          placeholder={t("Nomi separati da virgola (anche funzioni o persone esterne)")}
          onChange={(value) => {
            setParticipants(value);
            setDirty(true);
          }}
        />
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParticipants(task.participants ?? "");
                setDirty(false);
              }}
            >
              {t("Annulla")}
            </Button>
            <Button size="sm" disabled={update.isPending} onClick={save}>
              {t("Salva presenti")}
            </Button>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-muted/60"
          aria-expanded={minutesOpen}
          onClick={() => setMinutesOpen((prev) => !prev)}
        >
          {minutesOpen ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <span className="font-medium">{t("Verbale")}</span>
          <span className="text-muted-foreground">
            {isLoading
              ? "…"
              : noteCount === 0
                ? t("nessuna nota")
                : t("{{count}} note su {{groups}} attività", {
                    count: noteCount,
                    groups: minutes?.groups.length,
                  })}
          </span>
        </button>

        {minutesOpen && !isLoading && (
          <div className="mt-1 flex flex-col gap-2 pl-6">
            {noteCount === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("Le note scritte sulle attività scegliendo questo incontro compaiono qui.")}
              </p>
            )}
            {minutes?.groups.map((group) => (
              <div key={group.task.id} className="rounded-md border bg-background p-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: group.task.statusColor }}
                    title={group.task.statusName}
                  />
                  {group.task.title}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {group.notes.map((note) => (
                    <li key={note.id} className="text-xs text-muted-foreground">
                      <span className="whitespace-pre-wrap text-foreground">{note.body}</span>
                      <span className="ml-1">— {note.author.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
