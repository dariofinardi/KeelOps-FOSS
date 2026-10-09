/**
 * The cards on a board — the rules of the core's `modules/boards/task-service.ts`:
 *
 *  - a task is born in the initial column (or the one asked for, if it belongs
 *    to the board), assigned and supervised by whoever creates it;
 *  - moving into a closed column stamps `closedAt` once; moving out clears it;
 *  - archiving hides without deleting, `includeArchived` shows it again;
 *  - deleting is for real: personal cards never went through the bin, and
 *    still do not;
 *  - every creation leaves an activity row — the core's ActivityLog did, and
 *    the four rows there are carried over by the migration script.
 */
import { randomUUID } from "node:crypto";
import { badRequest, notFound } from "./validate.mjs";
import { getBoardForView } from "./boards.mjs";

const now = () => new Date().toISOString();

async function usersById(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const rows = await db.all(
    `SELECT id, name FROM User WHERE id IN (${wanted.map(() => "?").join(", ")})`,
    ...wanted,
  );
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name }]));
}

const toDto = (row, users) => ({
  id: row.id,
  title: row.title,
  description: row.description ?? null,
  boardId: row.boardId,
  boardStatusId: row.statusId,
  assignee: users.get(row.assigneeId) ?? null,
  supervisor: users.get(row.supervisorId) ?? null,
  dueDate: row.dueDate ?? null,
  dueTime: row.dueTime ?? null,
  createdAt: row.createdAt,
  closedAt: row.closedAt ?? null,
  archived: row.archivedAt !== null && row.archivedAt !== undefined,
  attachmentCount: 0,
  commentCount: 0,
});

const COLUMNS = `id, boardId, statusId, creatorId, assigneeId, supervisorId, title, description,
  dueDate, dueTime, position, createdAt, updatedAt, closedAt, archivedAt`;

async function withUsers(db, rows) {
  const users = await usersById(db, rows.flatMap((r) => [r.assigneeId, r.supervisorId]));
  return rows.map((r) => toDto(r, users));
}

/** Only internal, active people can be put on a card. */
async function assertPerson(db, id, what) {
  if (id === null || id === undefined) return;
  const row = await db.get(
    `SELECT id FROM User WHERE id = ? AND isActive = 1 AND isSystem = 0 AND role IN ('ADMIN', 'MEMBER')`,
    id,
  );
  if (!row) throw badRequest(`${what}: persona non valida`);
}

export async function listTasks(db, user, boardId, includeArchived = false) {
  await getBoardForView(db, user, boardId);
  const rows = await db.all(
    `SELECT ${COLUMNS} FROM plugin_personale_task WHERE boardId = ?${
      includeArchived ? "" : " AND archivedAt IS NULL"
    } ORDER BY createdAt, id`,
    boardId,
  );
  return withUsers(db, rows);
}

async function loadTask(db, boardId, taskId) {
  const row = await db.get(
    `SELECT ${COLUMNS} FROM plugin_personale_task WHERE id = ? AND boardId = ?`,
    taskId, boardId,
  );
  if (!row) throw notFound("Task non trovato");
  return row;
}

export async function createTask(db, user, boardId, input) {
  const board = await getBoardForView(db, user, boardId);
  const target = input.statusId
    ? board.statuses.find((s) => s.id === input.statusId)
    : board.statuses.find((s) => s.isInitial);
  if (!target) throw badRequest("Stato non valido per questa board");
  const assigneeId = input.assigneeId === undefined ? user.id : input.assigneeId;
  const supervisorId = input.supervisorId === undefined ? user.id : input.supervisorId;
  await assertPerson(db, assigneeId, "assegnatario");
  await assertPerson(db, supervisorId, "supervisore");

  const id = randomUUID();
  const t = now();
  await db.run(
    `INSERT INTO plugin_personale_task (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)`,
    id, boardId, target.id, user.id, assigneeId, supervisorId, input.title, input.description,
    input.dueDate, input.dueTime, t, t, target.isClosed ? t : null,
  );
  await db.run(
    `INSERT INTO plugin_personale_activity (id, taskId, userId, action, payload, createdAt) VALUES (?, ?, ?, 'created', NULL, ?)`,
    randomUUID(), id, user.id, t,
  );
  const [dto] = await withUsers(db, [await loadTask(db, boardId, id)]);
  return dto;
}

export async function updateTask(db, user, boardId, taskId, input) {
  const board = await getBoardForView(db, user, boardId);
  const existing = await loadTask(db, boardId, taskId);

  const sets = [];
  const params = [];
  const set = (column, value) => { sets.push(`${column} = ?`); params.push(value); };

  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description);
  if (input.assigneeId !== undefined) { await assertPerson(db, input.assigneeId, "assegnatario"); set("assigneeId", input.assigneeId); }
  if (input.supervisorId !== undefined) { await assertPerson(db, input.supervisorId, "supervisore"); set("supervisorId", input.supervisorId); }
  if (input.dueDate !== undefined) set("dueDate", input.dueDate);
  if (input.dueTime !== undefined) set("dueTime", input.dueTime);
  if (input.archived !== undefined) set("archivedAt", input.archived ? now() : null);
  if (input.statusId !== undefined) {
    const target = board.statuses.find((s) => s.id === input.statusId);
    if (!target) throw badRequest("Stato non valido per questa board");
    set("statusId", target.id);
    // Entering a closed column stamps the date once; leaving it clears it.
    set("closedAt", target.isClosed ? (existing.closedAt ?? now()) : null);
  }
  if (sets.length > 0) {
    set("updatedAt", now());
    await db.run(`UPDATE plugin_personale_task SET ${sets.join(", ")} WHERE id = ?`, ...params, taskId);
  }
  const [dto] = await withUsers(db, [await loadTask(db, boardId, taskId)]);
  return dto;
}

/** For real: a personal card never went through the bin, and still does not. */
export async function deleteTask(db, user, boardId, taskId) {
  await getBoardForView(db, user, boardId);
  await loadTask(db, boardId, taskId);
  await db.run(`DELETE FROM plugin_personale_task WHERE id = ?`, taskId);
}

/** Today in the company timezone (Europe/Rome), as an ISO day: the core's `todayISO`. */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The groups of the core's dashboard, by the same rule (`modules/dashboard/routes.ts`):
 * overdue (before today), today, tomorrow, next (the four days after tomorrow),
 * none (no date). `GRUPPI` is the order the dashboard shows them in.
 */
export const GRUPPI = ["overdue", "today", "tomorrow", "next", "none"];

export function gruppoDi(dueDate, today) {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate === plusDays(today, 1)) return "tomorrow";
  if (dueDate < plusDays(today, 6)) return "next";
  return null;   // further away: on no dashboard tile
}

/**
 * What the dashboard tile shows: my open cards (assigned to me, not archived,
 * not in a closed column), with the board and the column they sit in — all of
 * them, or only the ones of one dashboard group (`gruppo`).
 */
export async function dashboardTasks(db, user, { gruppo = null, today = todayISO() } = {}) {
  const rows = await db.all(
    `SELECT t.id, t.title, t.dueDate, t.dueTime, t.boardId, b.name AS boardName,
            s.name AS statusName, s.color AS statusColor
       FROM plugin_personale_task t
       JOIN plugin_personale_board b ON b.id = t.boardId
       JOIN plugin_personale_status s ON s.id = t.statusId
      WHERE t.assigneeId = ? AND t.archivedAt IS NULL AND s.isClosed = 0 AND b.ownerId = ?
      ORDER BY t.dueDate IS NULL, t.dueDate, t.createdAt`,
    user.id, user.id,
  );
  return rows
    .filter((r) => gruppo === null || gruppoDi(r.dueDate ?? null, today) === gruppo)
    .map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.dueDate ?? null,
      dueTime: r.dueTime ?? null,
      boardId: r.boardId,
      boardName: r.boardName,
      status: { name: r.statusName, color: r.statusColor },
      gruppo: gruppoDi(r.dueDate ?? null, today),
    }));
}

/** How many open cards of mine sit in each dashboard group: the numbers on the chips. */
export async function dashboardCounts(db, user, today = todayISO()) {
  const counts = Object.fromEntries(GRUPPI.map((g) => [g, 0]));
  for (const t of await dashboardTasks(db, user, { today })) if (t.gruppo) counts[t.gruppo] += 1;
  return counts;
}

/**
 * For the morning digest: every owner with open cards overdue or due today
 * or tomorrow, with the three counts. One query over everyone: the core calls
 * this once a day, not once per user.
 */
export async function scadenzePerUtente(db, today = todayISO()) {
  const rows = await db.all(
    `SELECT t.assigneeId AS userId, t.dueDate
       FROM plugin_personale_task t
       JOIN plugin_personale_board b ON b.id = t.boardId
       JOIN plugin_personale_status s ON s.id = t.statusId
      WHERE t.assigneeId IS NOT NULL AND t.archivedAt IS NULL AND s.isClosed = 0
        AND b.ownerId = t.assigneeId AND t.dueDate IS NOT NULL AND t.dueDate <= ?`,
    plusDays(today, 1),
  );
  const byUser = new Map();
  for (const r of rows) {
    const g = gruppoDi(r.dueDate, today);
    if (!["overdue", "today", "tomorrow"].includes(g)) continue;
    const bucket = byUser.get(r.userId) ?? { overdue: 0, today: 0, tomorrow: 0 };
    bucket[g] += 1;
    byUser.set(r.userId, bucket);
  }
  return byUser;
}
