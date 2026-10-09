/** Le forme che le API del plugin restituiscono: le stesse di `schemas/boards.ts` del core. */
export interface BoardStatus {
  id: string;
  name: string;
  color: string;
  order: number;
  isInitial: boolean;
  isClosed: boolean;
}

export interface Board {
  id: string;
  name: string;
  order: number;
  shared: boolean;
  canManage: boolean;
  statuses: BoardStatus[];
}

export interface UserRef {
  id: string;
  name: string;
}

export interface BoardTask {
  id: string;
  title: string;
  description: string | null;
  boardId: string;
  boardStatusId: string;
  assignee: UserRef | null;
  supervisor: UserRef | null;
  dueDate: string | null;
  dueTime: string | null;
  createdAt: string;
  closedAt: string | null;
  archived: boolean;
}

export interface DashboardTask {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  boardId: string;
  boardName: string;
  status: { name: string; color: string };
  /** Il gruppo della dashboard del core in cui cade (null = più in là di una settimana). */
  gruppo: GruppoDashboard | null;
}

/** I gruppi della giornata del core, con la sua regola (ritardo, oggi, domani, prossimi giorni, senza data). */
export type GruppoDashboard = "overdue" | "today" | "tomorrow" | "next" | "none";

/** I filtri di una bacheca, ricordati per bacheca. */
export interface Filtri {
  q: string;
  colonna: string;
  scadenza: "" | "overdue" | "today" | "week" | "none";
}
export const FILTRI_VUOTI: Filtri = { q: "", colonna: "", scadenza: "" };

export const TEMPLATE_KEYS = ["empty", "review", "gtd", "eisenhower", "week"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Le colonne che ogni template crea, per l'anteprima nel selettore. */
export const TEMPLATE_COLUMNS: Record<TemplateKey, string[]> = {
  empty: ["Da fare", "In corso", "Fatto"],
  review: ["Da fare", "In corso", "In revisione", "Fatto"],
  gtd: ["In entrata", "Prossime azioni", "In attesa", "Un giorno", "Fatto"],
  eisenhower: ["Urgente e importante", "Importante", "Urgente", "Fatto"],
  week: ["Lun", "Mar", "Mer", "Gio", "Ven", "Fatto"],
};
