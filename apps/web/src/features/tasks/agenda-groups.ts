import type { TaskListItem } from "@kancrm/shared";

export interface AgendaGroup {
  key: string;
  label: string;
  tasks: TaskListItem[];
  tone?: "danger" | "warn";
  /** Riga esplicativa sotto al gruppo (es. quanti completati restano fuori). */
  note?: string;
}

/**
 * Quanto storico di "fatto" tiene l'agenda. Serve a confermare il lavoro appena
 * chiuso, non a fare da archivio: per quello c'è la Tabella. Due limiti insieme,
 * perché uno solo non basta — chiudendone molti in un giorno il tetto temporale
 * non basterebbe, lavorando poco basterebbe il tetto numerico a far riemergere
 * roba di mesi fa.
 */
export const RECENT_CLOSED_DAYS = 7;
export const RECENT_CLOSED_MAX = 10;

/** Data (YYYY-MM-DD) di N giorni prima di `today`. */
function daysBefore(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Completati da mostrare in agenda: i più recenti entro la finestra, troncati al
 * massimo. Conta QUANDO sono stati chiusi, non la scadenza: un task con scadenza
 * di gennaio ma chiuso ieri è lavoro appena fatto. Chi non ha la data di chiusura
 * (storico importato) resta fuori: non è "recente" per definizione.
 */
function recentlyClosed(closed: TaskListItem[], today: string): AgendaGroup | null {
  const since = daysBefore(today, RECENT_CLOSED_DAYS);
  const recent = closed
    .filter((t) => t.closedAt !== null && t.closedAt.slice(0, 10) >= since)
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  if (recent.length === 0) return null;

  const shown = recent.slice(0, RECENT_CLOSED_MAX);
  const hidden = closed.length - shown.length;
  return {
    key: "closed",
    label: `Completati di recente`,
    tasks: shown,
    note: hidden > 0 ? `Altri ${hidden} completati non mostrati: li trovi in Tabella.` : undefined,
  };
}

/** Fine settimana (domenica) in formato YYYY-MM-DD. */
export function endOfWeekISO(today: string): string {
  const date = new Date(`${today}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = lunedì
  date.setUTCDate(date.getUTCDate() + (6 - weekday));
  return date.toISOString().slice(0, 10);
}

/**
 * Raggruppa i task dell'agenda per scadenza.
 *
 * I task CHIUSI restano fuori dai gruppi di scadenza: un task completato non è
 * "in ritardo" né "in scadenza oggi", anche se la sua data è passata. Quando
 * l'elenco li comprende (spunta "Mostra chiusi") finiscono in coda, e solo i più
 * recenti (vedi recentlyClosed). Con un giorno selezionato dal calendario si
 * mostra invece tutto quel che cadeva in quella data, chiusi inclusi: è una
 * domanda esplicita su un giorno.
 */
export function groupAgendaTasks(
  tasks: TaskListItem[],
  today: string,
  selectedDate: string | null,
  formatDate: (iso: string) => string,
): AgendaGroup[] {
  if (selectedDate) {
    return [
      {
        key: "selected",
        label: `Task del ${formatDate(selectedDate)}`,
        tasks: tasks.filter((t) => t.dueDate === selectedDate),
      },
    ];
  }
  const weekEnd = endOfWeekISO(today);
  const open = tasks.filter((t) => !t.status.isClosed);
  const closed = tasks.filter((t) => t.status.isClosed);
  const withDue = open.filter((t) => t.dueDate !== null);
  const closedGroup = recentlyClosed(closed, today);

  return [
    {
      key: "overdue",
      label: "In ritardo",
      tone: "danger" as const,
      tasks: withDue.filter((t) => t.dueDate! < today),
    },
    {
      key: "today",
      label: "Oggi",
      tone: "warn" as const,
      tasks: withDue.filter((t) => t.dueDate === today),
    },
    {
      key: "week",
      label: "Questa settimana",
      tasks: withDue.filter((t) => t.dueDate! > today && t.dueDate! <= weekEnd),
    },
    {
      key: "later",
      label: "Prossimi",
      tasks: withDue.filter((t) => t.dueDate! > weekEnd),
    },
    {
      key: "nodate",
      label: "Senza scadenza",
      tasks: open.filter((t) => t.dueDate === null),
    },
    ...(closedGroup ? [closedGroup] : []),
  ].filter((group) => group.tasks.length > 0);
}
