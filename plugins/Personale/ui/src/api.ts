/**
 * Le chiamate alla parte server del plugin (`../api/…`, relative: la pagina
 * vive sotto `/plugins/Personale/`) e, per una cosa sola, al core: l'ordine
 * personale delle colonne sta nel profilo dell'utente (`/api/profile/
 * column-order`), con la chiave `board:<id>` di sempre — la stessa origine,
 * lo stesso cookie, la stessa preferenza che aveva già.
 */
import type { Board, BoardTask, DashboardTask, GruppoDashboard, UserRef } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Chiamata = Omit<RequestInit, "body"> & { body?: unknown };

async function call<T>(path: string, init: Chiamata = {}): Promise<T> {
  const { body, ...resto } = init;
  const response = await fetch(path, {
    ...resto,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(resto.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as {
    errore?: string;
    message?: string;
    codice?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.errore ?? data.message ?? `Errore ${response.status}`,
      data.codice,
    );
  }
  return data as T;
}

const plugin = (path: string) => `api/${path}`;

export const api = {
  boards: () => call<{ boards: Board[] }>(plugin("boards")).then((r) => r.boards),
  createBoard: (body: { name: string; template: string }) =>
    call<Board>(plugin("boards"), { method: "POST", body }),
  renameBoard: (id: string, name: string) =>
    call<Board>(plugin(`boards/${id}`), { method: "PATCH", body: { name } }),
  deleteBoard: (id: string) => call<void>(plugin(`boards/${id}`), { method: "DELETE" }),
  reorderBoards: (order: string[]) =>
    call<{ boards: Board[] }>(plugin("boards/order"), { method: "PUT", body: { order } }),
  replaceStatuses: (
    id: string,
    statuses: Array<{
      id?: string;
      name: string;
      color: string;
      isInitial: boolean;
      isClosed: boolean;
    }>,
  ) => call<Board>(plugin(`boards/${id}/statuses`), { method: "PUT", body: { statuses } }),

  tasks: (boardId: string, includeArchived: boolean) =>
    call<{ tasks: BoardTask[] }>(
      plugin(`boards/${boardId}/tasks${includeArchived ? "?includeArchived=1" : ""}`),
    ).then((r) => r.tasks),
  createTask: (boardId: string, body: Record<string, unknown>) =>
    call<BoardTask>(plugin(`boards/${boardId}/tasks`), { method: "POST", body }),
  updateTask: (boardId: string, taskId: string, body: Record<string, unknown>) =>
    call<BoardTask>(plugin(`boards/${boardId}/tasks/${taskId}`), { method: "PATCH", body }),
  deleteTask: (boardId: string, taskId: string) =>
    call<void>(plugin(`boards/${boardId}/tasks/${taskId}`), { method: "DELETE" }),

  users: () => call<{ users: UserRef[] }>(plugin("utenti")).then((r) => r.users),
  dashboard: (gruppo?: GruppoDashboard) =>
    call<{ tasks: DashboardTask[]; me: UserRef }>(
      plugin(`dashboard${gruppo ? `?gruppo=${gruppo}` : ""}`),
    ),

  // Del core: la preferenza personale sull'ordine delle colonne, chiave `board:<id>`.
  columnOrders: () =>
    call<{ orders: Record<string, string[]> }>("/api/profile/column-order").then((r) => r.orders),
  setColumnOrder: (key: string, order: string[]) =>
    call<{ orders: Record<string, string[]> }>("/api/profile/column-order", {
      method: "PUT",
      body: { key, order },
    }),
};
