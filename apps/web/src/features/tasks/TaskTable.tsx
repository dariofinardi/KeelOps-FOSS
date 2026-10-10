// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { HandCoins, Link2, Repeat, X } from "lucide-react";
import type { SortDir, TaskListItem, TaskSortBy } from "@kancrm/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SortableHeader } from "@/components/ui/sortable-header";
import { useContextMenu } from "@/components/ui/context-menu";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/features/auth/useAuth";
import { TaskActivityTypeCell, TaskAssigneeCell, TaskStatusCell } from "./TaskInlineCells";
import { AttachmentsPeek, CommentsPeek } from "./TaskPeek";
import { useTaskMenuItems } from "./useTaskMenu";
import { useTaskStatuses } from "./useTasks";
import { dueState, dueStateClass, formatDate, formatDue } from "./task-utils";
import { ticketAccent } from "./ticket-accent";

/**
 * **La selezione multipla è nascosta** (richiesta del 05/09/2026): nessun'altra
 * vista ha caselle di selezione né azioni di massa, e la spunta «fatto» sulla
 * riga è andata via con lei — lo stato si cambia dalla tendina sulla riga, dal
 * menù o dal pannello, gesti espliciti. Il codice resta dietro l'interruttore,
 * se un giorno si decidesse di rimetterla.
 */
const SELEZIONE_MULTIPLA = false;

interface TaskTableProps {
  tasks: TaskListItem[];
  onOpen: (id: string) => void;
  sortBy?: TaskSortBy;
  sortDir: SortDir;
  onSort: (column: TaskSortBy) => void;
}

export function TaskTable({ tasks, onOpen, sortBy, sortDir, onSort }: TaskTableProps) {
  const { t } = useTranslation();
  const { open, menu } = useContextMenu();
  const menuItems = useTaskMenuItems(onOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));
  // Mantieni in selezione solo i task ancora presenti nella lista corrente.
  const selectedIds = tasks.filter((t) => selected.has(t.id)).map((t) => t.id);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t("Nessun task trovato con i filtri correnti.")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {SELEZIONE_MULTIPLA && <BulkBar ids={selectedIds} onDone={() => setSelected(new Set())} />}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              {SELEZIONE_MULTIPLA && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={t("Seleziona tutti")}
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <SortableHeader
                label={t("Titolo")}
                column="title"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortableHeader
                label={t("Stato")}
                column="status"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortableHeader
                label={t("Assegnatario")}
                column="assignee"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortableHeader
                label={t("Scadenza")}
                column="dueDate"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              {/* Creazione: dice da quanto un task aspetta, ed è l'ordine con
                  cui si svuota una lista che si è allungata (14/08/2026). */}
              <SortableHeader
                label={t("Creato")}
                column="createdAt"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-right font-medium">{t("Allegati / Commenti")}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const due = dueState(task);
              // Richiesta da ticket: un filo a sinistra col colore della
              // priorità. Sulla riga un bordo intero urlerebbe.
              const accent = ticketAccent(task);
              return (
                <tr
                  key={task.id}
                  title={accent ? t(accent.titleKey) : undefined}
                  className={cn(
                    "cursor-pointer border-b last:border-0 hover:bg-muted/30",
                    accent?.left,
                    selected.has(task.id) && "bg-primary/5",
                  )}
                  onClick={() => onOpen(task.id)}
                  onContextMenu={(e) => open(e, menuItems(task))}
                >
                  {SELEZIONE_MULTIPLA && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={t("Seleziona {{title}}", { title: task.title })}
                        checked={selected.has(task.id)}
                        onChange={() => toggle(task.id)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    {task.recurrenceTemplateId && (
                      <Repeat
                        className="mr-1.5 inline size-3.5 text-muted-foreground"
                        aria-label={t("Ricorrente")}
                      />
                    )}
                    {task.predecessorId && (
                      <Link2
                        className="mr-1.5 inline size-3.5 text-muted-foreground"
                        aria-label={t("In sequenza")}
                      />
                    )}
                    <span className="task-title">{task.title}</span>
                    <span className="ml-2 align-middle">
                      <TaskActivityTypeCell task={task} />
                    </span>
                    {task.relatedDeal && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                        title={t("Collegato all'offerta: {{title}}", {
                          title: task.relatedDeal.title,
                        })}
                      >
                        <HandCoins className="size-3" /> {task.relatedDeal.title}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TaskStatusCell task={task} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <TaskAssigneeCell
                      task={task}
                      className="text-sm underline-offset-2 hover:underline"
                    />
                  </td>
                  <td
                    className={cn(
                      // "23/07/2026 · 15:00" su due righe non è una data, è un
                      // incidente: la colonna si prende lo spazio che serve.
                      "whitespace-nowrap px-4 py-3",
                      due ? dueStateClass[due] : "text-muted-foreground",
                    )}
                  >
                    {formatDue(task)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDate(task.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3 text-muted-foreground">
                      <AttachmentsPeek taskId={task.id} count={task.attachmentCount} />
                      <CommentsPeek taskId={task.id} count={task.commentCount} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {menu}
      </div>
    </div>
  );
}

/**
 * Barra azioni multiple: appare quando ci sono task selezionati e permette di
 * assegnarli a sé, cambiarne lo stato o eliminarli in blocco. Le operazioni
 * girano in parallelo con un'unica notifica riepilogativa.
 */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const { data: statuses } = useTaskStatuses();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (ids.length === 0) return null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const run = async (task: (id: string) => Promise<unknown>, successText: string) => {
    setBusy(true);
    const results = await Promise.allSettled(ids.map(task));
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    invalidate();
    onDone();
    if (failed === 0) toast(successText, "success");
    else
      toast(
        t("{{updated}} aggiornati, {{failed}} non riusciti", {
          updated: ids.length - failed,
          failed,
        }),
        "error",
      );
  };

  const assignToMe = () =>
    run(
      (id) => api(`/api/tasks/${id}`, { method: "PATCH", body: { assigneeId: currentUser.id } }),
      t("{{count}} task assegnati a te", { count: ids.length }),
    );

  const setStatus = (statusId: string) => {
    if (!statusId) return;
    void run(
      (id) =>
        api(`/api/tasks/${id}`, {
          method: "PATCH",
          // Bulk: forza oltre gli avvisi di sequenza/subtask (azione intenzionale).
          body: { statusId, confirmSequence: true, confirmSubtasks: true },
        }),
      t("Stato aggiornato su {{count}} task", { count: ids.length }),
    );
  };

  const remove = () => {
    void confirm({
      title: t("Eliminare {{count}} task?", { count: ids.length }),
      message: t("Verranno spostati nel cestino (con i loro subtask)."),
      confirmLabel: t("Sposta nel cestino"),
      tone: "danger",
    }).then((ok) => {
      if (ok) {
        void run(
          (id) => api(`/api/tasks/${id}`, { method: "DELETE" }),
          t("{{count}} task nel cestino", { count: ids.length }),
        );
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <span className="font-medium">{t("{{count}} selezionati", { count: ids.length })}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={assignToMe}>
        {t("Assegna a me")}
      </Button>
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value=""
        disabled={busy}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">{t("Cambia stato…")}</option>
        {statuses?.map((status) => (
          <option key={status.id} value={status.id}>
            {status.name}
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
        {t("Elimina")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onDone}
        title={t("Deseleziona tutto")}
      >
        <X className="size-4" /> {t("Deseleziona")}
      </Button>
    </div>
  );
}
