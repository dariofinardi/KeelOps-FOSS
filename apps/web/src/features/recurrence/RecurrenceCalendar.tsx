import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import type { TaskListItem } from "@kancrm/shared";
import { cn } from "@/lib/utils";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useTasks } from "@/features/tasks/useTasks";
import { todayISO } from "@/features/tasks/task-utils";

const WEEKDAYS_IT = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

/** Numero di settimane mostrate: la corrente più le tre successive. */
const WEEKS = 4;

const WEEK_LABELS = [
  "Questa settimana",
  "Prossima settimana",
  "Tra due settimane",
  "Tra tre settimane",
];

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lunedì della settimana che contiene `iso`. */
function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = lunedì
  return addDaysISO(iso, -weekday);
}

function dayNumber(iso: string): string {
  return iso.slice(8, 10);
}

function monthLabel(iso: string): string {
  return MONTHS_IT[Number(iso.slice(5, 7)) - 1] ?? "";
}

/** Intestazione della settimana: "21 – 27 luglio" oppure "28 luglio – 3 agosto". */
function weekLabel(monday: string, tr: (key: string) => string): string {
  const sunday = addDaysISO(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return sameMonth
    ? `${dayNumber(monday)} – ${dayNumber(sunday)} ${tr(monthLabel(monday))}`
    : `${dayNumber(monday)} ${tr(monthLabel(monday))} – ${dayNumber(sunday)} ${tr(monthLabel(sunday))}`;
}

interface RecurrenceCalendarProps {
  /** Apre il dettaglio dell'occorrenza; assente = occorrenze non cliccabili. */
  onOpenTask?: (id: string) => void;
}

/**
 * Calendario delle occorrenze ricorrenti sulle prossime quattro settimane.
 *
 * Mostra i task già materializzati (non le regole): entro quattro settimane rientrano
 * sempre nella finestra di materializzazione a 60 giorni, e così si vede lo stato
 * reale di ogni scadenza, non solo la data teorica.
 */
export function RecurrenceCalendar({ onOpenTask }: RecurrenceCalendarProps) {
  const { t } = useTranslation();
  const today = todayISO();
  const start = mondayOf(today);
  const end = addDaysISO(start, WEEKS * 7 - 1);

  // Chiuse incluse: una scadenza completata resta visibile nel suo giorno.
  const { data, isLoading } = useTasks({ includeClosed: true, page: 1, pageSize: 1000 });

  const byDay = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const task of data?.items ?? []) {
      if (!task.recurrenceTemplateId || !task.dueDate) continue;
      if (task.dueDate < start || task.dueDate > end) continue;
      const list = map.get(task.dueDate);
      if (list) list.push(task);
      else map.set(task.dueDate, [task]);
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title, "it"));
    return map;
  }, [data, start, end]);

  if (isLoading) return <SkeletonRows rows={6} />;

  const total = [...byDay.values()].reduce((sum, list) => sum + list.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? t("Nessuna scadenza ricorrente nelle prossime quattro settimane.")
          : t(
              "{{count}} scadenze ricorrenti dal {{startDay}} {{startMonth}} al {{endDay}} {{endMonth}}.",
              {
                count: total,
                startDay: dayNumber(start),
                startMonth: t(monthLabel(start)),
                endDay: dayNumber(end),
                endMonth: t(monthLabel(end)),
              },
            )}
      </p>

      {Array.from({ length: WEEKS }).map((_, week) => {
        const monday = addDaysISO(start, week * 7);
        return (
          <section key={monday} className="rounded-lg border bg-card">
            <h3 className="border-b px-3 py-2 text-sm font-semibold">
              {WEEK_LABELS[week]
                ? t(WEEK_LABELS[week])
                : t("Tra {{count}} settimane", { count: week })}
              <span className="ml-2 font-normal text-muted-foreground">{weekLabel(monday, t)}</span>
            </h3>
            <div className="grid grid-cols-1 divide-y sm:grid-cols-7 sm:divide-x sm:divide-y-0">
              {Array.from({ length: 7 }).map((__, index) => {
                const iso = addDaysISO(monday, index);
                const tasks = byDay.get(iso) ?? [];
                const isToday = iso === today;
                const isWeekend = index >= 5;
                return (
                  <div
                    key={iso}
                    className={cn(
                      "min-h-[7rem] p-2",
                      isWeekend && "bg-muted/30",
                      isToday && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <div className="mb-1.5 flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isToday ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {t(WEEKDAYS_IT[index] ?? "").slice(0, 3)}
                      </span>
                      <span className={cn("text-sm font-semibold", isToday && "text-primary")}>
                        {dayNumber(iso)}
                      </span>
                      {isToday && (
                        <span className="text-[10px] font-medium text-primary">{t("oggi")}</span>
                      )}
                    </div>

                    <ul className="flex flex-col gap-1">
                      {tasks.map((task) => {
                        const content = (
                          <>
                            <span
                              className="mt-1 size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: task.status.color }}
                              aria-hidden
                            />
                            <span
                              className={cn(
                                "min-w-0 break-words",
                                task.status.isClosed && "text-muted-foreground line-through",
                              )}
                            >
                              {task.title}
                            </span>
                          </>
                        );
                        const title = `${task.title} — ${task.status.name}${
                          task.assignee ? ` · ${task.assignee.name}` : ""
                        }`;
                        return (
                          <li key={task.id}>
                            {onOpenTask ? (
                              <button
                                type="button"
                                className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                                title={title}
                                onClick={() => onOpenTask(task.id)}
                              >
                                {content}
                              </button>
                            ) : (
                              <span
                                className="flex items-start gap-1.5 px-1 py-0.5 text-xs"
                                title={title}
                              >
                                {content}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Repeat className="size-3.5" />
        {t(
          "Solo le scadenze generate dalle ricorrenze. Il pallino indica lo stato; le completate sono barrate.",
        )}
      </p>
    </div>
  );
}
