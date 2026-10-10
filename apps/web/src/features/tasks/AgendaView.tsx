// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, FolderKanban, HandCoins, Repeat } from "lucide-react";
import type { TaskListItem } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionToggle } from "@/components/ui/section-toggle";
import { useListPrefs } from "@/lib/useListPrefs";
import { useContextMenu } from "@/components/ui/context-menu";
import { TaskActivityTypeCell, TaskAssigneeCell, TaskStatusCell } from "./TaskInlineCells";
import { AttachmentsPeek, CommentsPeek } from "./TaskPeek";
import { useTaskMenuItems } from "./useTaskMenu";
import { groupAgendaTasks } from "./agenda-groups";
import { hasTaskReference, taskReferenceOf } from "./task-reference";
import { dueState, dueStateClass, formatDate, formatDue, todayISO } from "./task-utils";
import { ticketAccent } from "./ticket-accent";

interface AgendaViewProps {
  /**
   * Mostra a chi è intestato ogni task, con la tendina per riassegnarlo. Si
   * accende quando NON si sta filtrando per persona: filtrando, il nome sarebbe
   * lo stesso su ogni riga e ruberebbe spazio al riferimento.
   */
  showAssignee?: boolean;
  tasks: TaskListItem[];
  onOpen: (id: string) => void;
}

/** Offerta o progetto a cui il task fa capo, con l'azienda cliente. */
function TaskReferenceCell({ task }: { task: TaskListItem }) {
  const { t } = useTranslation();
  const reference = taskReferenceOf(task);
  if (!hasTaskReference(reference)) return null;
  const Icona = reference.kind === "deal" ? HandCoins : FolderKanban;
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      title={
        reference.label
          ? `${reference.kind === "deal" ? t("Offerta") : t("Progetto")}: ${reference.label}${
              reference.company ? ` — ${reference.company}` : ""
            }`
          : `${t("Azienda")}: ${reference.company}`
      }
    >
      {reference.label && (
        <>
          <Icona className="size-3.5 shrink-0" />
          <span className="truncate">{reference.label}</span>
        </>
      )}
      {reference.company && (
        <>
          {reference.label && <span className="shrink-0">·</span>}
          <span className="truncate font-medium text-foreground/70">{reference.company}</span>
        </>
      )}
    </span>
  );
}

/**
 * Quali gruppi dell'agenda nascono aperti.
 *
 * Aperto ciò che riguarda l'oggi — il ritardo, la giornata, la settimana — e
 * chiuso il resto: "Prossimi" può contenere ottantanove task, e sotto di essi
 * la settimana non si vede più. Da chiusi restano l'intestazione e il numero,
 * che è già l'informazione ("ce ne sono 89, non adesso"). Ogni scelta poi si
 * ricorda, come ogni altro filtro dell'applicazione.
 */
const SECTIONS_OPEN_BY_DEFAULT = {
  overdue: true,
  today: true,
  week: true,
  selected: true,
  later: false,
  nodate: false,
  closed: false,
};

export function AgendaView({ tasks, onOpen, showAssignee = true }: AgendaViewProps) {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { prefs: openSections, update: setOpenSections } = useListPrefs(
    "kancrm-agenda-sections",
    SECTIONS_OPEN_BY_DEFAULT,
  );
  const { open, menu } = useContextMenu();
  const menuItems = useTaskMenuItems(onOpen);
  const today = todayISO();

  const groups = useMemo(
    () => groupAgendaTasks(tasks, today, selectedDate, formatDate),
    [tasks, today, selectedDate],
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        {groups.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {selectedDate
              ? t("Nessun task in scadenza il {{date}}.", { date: formatDate(selectedDate) })
              : t("Nessun task aperto.")}
          </div>
        )}
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const isOpen = openSections[group.key as keyof typeof SECTIONS_OPEN_BY_DEFAULT] ?? true;
            return (
              <section key={group.key}>
                <h3
                  className={cn(
                    "text-sm font-semibold uppercase tracking-wide",
                    isOpen && "mb-2",
                    group.tone === "danger"
                      ? "text-destructive"
                      : group.tone === "warn"
                        ? "text-amber-600"
                        : "text-muted-foreground",
                  )}
                >
                  <SectionToggle
                    open={isOpen}
                    onToggle={(value) => setOpenSections({ [group.key]: value })}
                  >
                    {group.label} ({group.tasks.length})
                  </SectionToggle>
                </h3>
                {!isOpen ? null : (
                  <>
                    {group.note && (
                      <p className="mb-2 text-xs text-muted-foreground">{group.note}</p>
                    )}
                    <ul className="flex flex-col gap-1.5">
                      {group.tasks.map((task) => {
                        const due = dueState(task);
                        // Richiesta da ticket: filo a sinistra col colore della
                        // priorità, come in tabella e dentro il progetto.
                        const accent = ticketAccent(task);
                        return (
                          <li key={task.id}>
                            {/*
                        Riga cliccabile ma non <button>: contiene le celle modificabili
                        (combo e pulsanti), che l'HTML non ammette dentro un bottone.
                        role/tabIndex/onKeyDown mantengono l'uso da tastiera.
                      */}
                            <div
                              role="button"
                              tabIndex={0}
                              /*
                          Su schermo stretto la riga va a capo: il titolo si
                          prende la prima riga tutta intera, stato e data la
                          seconda. Prima il titolo aveva `flex-1` con base zero
                          e, mancando lo spazio, era lui a essere schiacciato a
                          zero mentre il badge di stato teneva la sua larghezza:
                          dal telefono si vedeva una riga senza titolo.
                        */
                              title={accent ? t(accent.titleKey) : undefined}
                              className={cn(
                                "flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                accent?.left,
                              )}
                              onClick={() => onOpen(task.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onOpen(task.id);
                                }
                              }}
                              onContextMenu={(e) => open(e, menuItems(task))}
                            >
                              <span className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {task.recurrenceTemplateId && (
                                    <Repeat
                                      className="mr-1.5 inline size-3.5 text-muted-foreground"
                                      aria-label={t("Ricorrente")}
                                    />
                                  )}
                                  {task.title}
                                </span>
                              </span>
                              {/* A cosa fa capo il lavoro, al posto di chi lo fa: negli
                            elenchi la persona la si sta già filtrando, mentre
                            "Attività agosto" da solo non dice per chi. */}
                              <span className="hidden min-w-0 max-w-56 shrink-0 md:block">
                                <TaskReferenceCell task={task} />
                              </span>
                              {showAssignee && (
                                <span className="hidden lg:block">
                                  <TaskAssigneeCell task={task} />
                                </span>
                              )}
                              <span className="hidden sm:inline-flex">
                                <TaskActivityTypeCell task={task} />
                              </span>
                              <TaskStatusCell task={task} />
                              <span
                                className={cn(
                                  // Sulla seconda riga (telefono) data e icone stanno
                                  // a destra, con lo stato a sinistra.
                                  "ml-auto w-20 text-right text-xs sm:ml-0",
                                  due ? dueStateClass[due] : "text-muted-foreground",
                                )}
                              >
                                {formatDue(task)}
                              </span>
                              <span className="flex w-16 justify-end gap-2 text-muted-foreground">
                                <AttachmentsPeek taskId={task.id} count={task.attachmentCount} />
                                <CommentsPeek taskId={task.id} count={task.commentCount} />
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <MiniCalendar
        tasks={tasks}
        selectedDate={selectedDate}
        onSelect={(date) => setSelectedDate((prev) => (prev === date ? null : date))}
      />
      {menu}
    </div>
  );
}

const MONTHS_IT = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

function MiniCalendar({
  tasks,
  selectedDate,
  onSelect,
}: {
  tasks: TaskListItem[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const { t } = useTranslation();
  const today = todayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1); // 0-based

  const dueDates = useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks) if (task.dueDate) set.add(task.dueDate);
    return set;
  }, [tasks]);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const leadingEmpty = (firstOfMonth.getUTCDay() + 6) % 7; // settimana da lunedì
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const dayISO = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  };

  return (
    <aside className="w-full shrink-0 lg:w-64">
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shift(-1)}
            title={t("Mese precedente")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold">
            {t(MONTHS_IT[month] ?? "")} {year}
          </span>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} title={t("Mese successivo")}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
          {["L", "M", "M", "G", "V", "S", "D"].map((label, index) => (
            <span key={index} className="py-1 font-medium text-muted-foreground">
              {label}
            </span>
          ))}
          {Array.from({ length: leadingEmpty }).map((_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, index) => {
            const day = index + 1;
            const iso = dayISO(day);
            const hasTasks = dueDates.has(iso);
            const isToday = iso === today;
            const isSelected = iso === selectedDate;
            return (
              <button
                key={iso}
                onClick={() => onSelect(iso)}
                className={cn(
                  "relative rounded-md py-1.5 transition-colors hover:bg-accent",
                  isToday && "font-bold text-primary",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                {day}
                {hasTasks && (
                  <span
                    className={cn(
                      "absolute inset-x-0 bottom-0.5 mx-auto size-1 rounded-full",
                      isSelected ? "bg-primary-foreground" : "bg-primary",
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
        {selectedDate && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => onSelect(selectedDate)}
          >
            {t("Mostra tutte le date")}
          </Button>
        )}
      </div>
    </aside>
  );
}
