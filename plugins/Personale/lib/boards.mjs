// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Boards and their columns — the rules the core had in `modules/boards/service.ts`,
 * ported one by one (each has its case in selftest.mjs):
 *
 *  - a board is private: another user neither sees it nor touches it (404, so
 *    that its existence is not revealed);
 *  - the first time someone opens the page they get «Mia» with five standard
 *    columns — once: delete it and it does not come back (the mark is in
 *    `plugin_personale_owner`, where the core kept `User.boardsInitializedAt`);
 *  - templates create their columns with one initial and one closed;
 *  - replacing the columns keeps the ids of the ones still there, refuses to
 *    delete a column that has tasks in it, and the constraints (one initial,
 *    at least one closed, distinct names) are validated before;
 *  - deleting a board deletes its tasks (the database cascades).
 */
import { randomUUID } from "node:crypto";
import { badRequest, conflict, notFound } from "./validate.mjs";

const now = () => new Date().toISOString();

/** Cyclic palette for the middle columns of a template (first/last have their own). */
const TEMPLATE_PALETTE = ["#2563eb", "#eab308", "#f97316", "#a855f7", "#06b6d4"];

const statusesFromNames = (names) =>
  names.map((name, i) => ({
    name,
    color:
      i === 0
        ? "#94a3b8"
        : i === names.length - 1
          ? "#22c55e"
          : (TEMPLATE_PALETTE[(i - 1) % TEMPLATE_PALETTE.length] ?? "#2563eb"),
    position: i,
    isInitial: i === 0,
    isClosed: i === names.length - 1,
  }));

export const TEMPLATE_STATUSES = {
  empty: statusesFromNames(["Da fare", "In corso", "Fatto"]),
  review: statusesFromNames(["Da fare", "In corso", "In revisione", "Fatto"]),
  gtd: statusesFromNames(["In entrata", "Prossime azioni", "In attesa", "Un giorno", "Fatto"]),
  eisenhower: statusesFromNames(["Urgente e importante", "Importante", "Urgente", "Fatto"]),
  week: statusesFromNames(["Lun", "Mar", "Mer", "Gio", "Ven", "Fatto"]),
};

/** The welcome board «Mia»: a standard five-column kanban. */
export const STANDARD_STATUSES = [
  { name: "Da fare", color: "#94a3b8", position: 0, isInitial: true, isClosed: false },
  { name: "In corso", color: "#2563eb", position: 1, isInitial: false, isClosed: false },
  { name: "In attesa", color: "#eab308", position: 2, isInitial: false, isClosed: false },
  { name: "In revisione", color: "#f97316", position: 3, isInitial: false, isClosed: false },
  { name: "Fatto", color: "#22c55e", position: 4, isInitial: false, isClosed: true },
];

const statusRow = (r) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  order: Number(r.position),
  isInitial: Boolean(Number(r.isInitial)),
  isClosed: Boolean(Number(r.isClosed)),
});

async function statusesOf(db, boardIds) {
  if (boardIds.length === 0) return new Map();
  const rows = await db.all(
    `SELECT id, boardId, name, color, position, isInitial, isClosed FROM plugin_personale_status
      WHERE boardId IN (${boardIds.map(() => "?").join(", ")}) ORDER BY position, name`,
    ...boardIds,
  );
  const byBoard = new Map();
  for (const r of rows) byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), statusRow(r)]);
  return byBoard;
}

export const toBoardDto = (board) => ({
  id: board.id,
  name: board.name,
  order: Number(board.position),
  shared: false,
  canManage: true,
  statuses: board.statuses,
});

async function insertStatuses(db, boardId, statuses) {
  for (const s of statuses) {
    await db.run(
      `INSERT INTO plugin_personale_status (id, boardId, name, color, position, isInitial, isClosed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), boardId, s.name, s.color, s.position, s.isInitial ? 1 : 0, s.isClosed ? 1 : 0,
    );
  }
}

/**
 * The welcome board, once per person. The mark says «this user has been
 * initialised», which is different from «this user has no boards»: the core
 * once recreated «Mia» for whoever deleted their only board, and it looked
 * impossible to delete.
 */
async function ensureInitialized(db, user) {
  const seen = await db.get(`SELECT userId FROM plugin_personale_owner WHERE userId = ?`, user.id);
  if (seen) return;
  const has = await db.get(`SELECT COUNT(*) AS n FROM plugin_personale_board WHERE ownerId = ?`, user.id);
  if (Number(has?.n ?? 0) === 0) {
    const id = randomUUID();
    const t = now();
    await db.run(
      `INSERT INTO plugin_personale_board (id, ownerId, name, position, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
      id, user.id, "Mia", t, t,
    );
    await insertStatuses(db, id, STANDARD_STATUSES);
  }
  await db.run(
    `INSERT INTO plugin_personale_owner (userId, initializedAt) VALUES (?, ?) ${db.sql.upsert("userId", ["initializedAt"])}`,
    user.id, now(),
  );
}

export async function listBoards(db, user) {
  await ensureInitialized(db, user);
  const rows = await db.all(
    `SELECT id, ownerId, name, position, createdAt, updatedAt FROM plugin_personale_board
      WHERE ownerId = ? ORDER BY position, createdAt`,
    user.id,
  );
  const statuses = await statusesOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, statuses: statuses.get(r.id) ?? [] }));
}

/** Private: only the owner sees it, and anyone else gets a 404. */
export async function getBoardForView(db, user, id) {
  const row = await db.get(
    `SELECT id, ownerId, name, position, createdAt, updatedAt FROM plugin_personale_board WHERE id = ?`,
    id,
  );
  if (!row || row.ownerId !== user.id) throw notFound("Board non trovata");
  const statuses = await statusesOf(db, [id]);
  return { ...row, statuses: statuses.get(id) ?? [] };
}

export async function createBoard(db, user, { name, template }) {
  const dup = await db.get(
    `SELECT id FROM plugin_personale_board WHERE ownerId = ? AND name = ?`,
    user.id, name,
  );
  if (dup) throw conflict("Hai già una bacheca con questo nome");
  const count = await db.get(`SELECT COUNT(*) AS n FROM plugin_personale_board WHERE ownerId = ?`, user.id);
  const id = randomUUID();
  const t = now();
  await db.run(
    `INSERT INTO plugin_personale_board (id, ownerId, name, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    id, user.id, name, Number(count?.n ?? 0), t, t,
  );
  await insertStatuses(db, id, TEMPLATE_STATUSES[template] ?? TEMPLATE_STATUSES.empty);
  return getBoardForView(db, user, id);
}

export async function renameBoard(db, user, id, name) {
  await getBoardForView(db, user, id);
  const dup = await db.get(
    `SELECT id FROM plugin_personale_board WHERE ownerId = ? AND name = ? AND id <> ?`,
    user.id, name, id,
  );
  if (dup) throw conflict("Hai già una bacheca con questo nome");
  await db.run(`UPDATE plugin_personale_board SET name = ?, updatedAt = ? WHERE id = ?`, name, now(), id);
  return getBoardForView(db, user, id);
}

/** The tasks go with the board: the foreign keys cascade, and no orphan is left. */
export async function deleteBoard(db, user, id) {
  await getBoardForView(db, user, id);
  // Explicit, for engines where a cascade through RESTRICT would stop halfway:
  // tasks first (status RESTRICT), then the board (statuses CASCADE).
  await db.run(`DELETE FROM plugin_personale_task WHERE boardId = ?`, id);
  await db.run(`DELETE FROM plugin_personale_board WHERE id = ?`, id);
}

/** The order of the tabs: ids in the wanted order; the ones not named keep their place after. */
export async function reorderBoards(db, user, order) {
  const mine = await listBoards(db, user);
  const wanted = order.filter((id) => mine.some((b) => b.id === id));
  const rest = mine.map((b) => b.id).filter((id) => !wanted.includes(id));
  let position = 0;
  for (const id of [...wanted, ...rest]) {
    await db.run(`UPDATE plugin_personale_board SET position = ? WHERE id = ?`, position, id);
    position += 1;
  }
  return listBoards(db, user);
}

/**
 * Replace the whole set of columns keeping the ids of the ones still there:
 * the tasks point at those ids and must keep pointing at something. A column
 * with tasks in it cannot go — the tasks would vanish with it.
 */
export async function replaceStatuses(db, user, id, statuses) {
  const board = await getBoardForView(db, user, id);
  const existing = new Set(board.statuses.map((s) => s.id));
  const kept = new Set(statuses.filter((s) => s.id).map((s) => s.id));
  const toDelete = [...existing].filter((sid) => !kept.has(sid));
  if (toDelete.length > 0) {
    const stuck = await db.get(
      `SELECT COUNT(*) AS n FROM plugin_personale_task WHERE statusId IN (${toDelete.map(() => "?").join(", ")})`,
      ...toDelete,
    );
    if (Number(stuck?.n ?? 0) > 0) {
      throw badRequest("Sposta o completa prima i task nelle colonne che vuoi eliminare");
    }
    for (const sid of toDelete) await db.run(`DELETE FROM plugin_personale_status WHERE id = ?`, sid);
  }
  for (const [i, s] of statuses.entries()) {
    if (s.id && existing.has(s.id)) {
      await db.run(
        `UPDATE plugin_personale_status SET name = ?, color = ?, position = ?, isInitial = ?, isClosed = ? WHERE id = ?`,
        s.name, s.color, i, s.isInitial ? 1 : 0, s.isClosed ? 1 : 0, s.id,
      );
    } else {
      await db.run(
        `INSERT INTO plugin_personale_status (id, boardId, name, color, position, isInitial, isClosed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), id, s.name, s.color, i, s.isInitial ? 1 : 0, s.isClosed ? 1 : 0,
      );
    }
  }
  return getBoardForView(db, user, id);
}
