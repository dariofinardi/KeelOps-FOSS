// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/** The map reads: projects, a project's tasks, task detail, co-work. */
import { stripHtml } from "../../keelops-sdk/text.mjs";
import { taskPerimeter, projectPerimeter } from "../../keelops-sdk/perimeter.mjs";

const EPOCH = Date.UTC(2020, 0, 1);
const toDay = (iso) => (iso ? Math.floor((Date.parse(iso) - EPOCH) / 86_400_000) : null);

export async function listProjects(db, user) {
  const p = projectPerimeter(user);
  return await db.all(`
    SELECT p.id, p.name, COUNT(t.id) AS tasks
    FROM Project p LEFT JOIN Task t ON t.projectId = p.id AND t.deletedAt IS NULL
    WHERE ${p.where} AND p.isArchived = 0
    GROUP BY p.id HAVING tasks > 0 ORDER BY p.name`, ...p.params);
}

export async function projectTasks(db, user, projectId) {
  const per = taskPerimeter(user);
  const rows = await db.all(`
    SELECT t.id, t.title, t.description, t.parentTaskId, t.predecessorId,
           t.createdAt, t.updatedAt, t.closedAt, u.nickName, u.name AS assigneeName
    FROM Task t LEFT JOIN User u ON u.id = t.assigneeId
    WHERE t.projectId = ? AND ${per.where}
    ORDER BY t.createdAt`, projectId, ...per.params);
  const index = new Map(rows.map((r, i) => [r.id, i]));
  return rows.map((r) => ({
    id: r.id,
    title: stripHtml(r.title),
    text: stripHtml(r.description).slice(0, 300),
    closed: Boolean(r.closedAt),
    assignee: r.nickName || r.assigneeName || null,
    updatedAt: r.updatedAt,
    openedDay: toDay(r.createdAt),
    updatedDay: toDay(r.updatedAt),
    closedDay: toDay(r.closedAt),
    parentIndex: index.get(r.parentTaskId) ?? null,
    predecessorIndex: index.get(r.predecessorId) ?? null,
  }));
}

/** co-work: same person, hours on both tasks on the same day */
export async function coworkEdges(db, tasks) {
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const byUserDay = new Map();
  const marks = await db.all(`
    SELECT e.userId, ${db.sql.dayOf("e.date")} AS day, e.taskId
    FROM TimeEntry e WHERE e.taskId IN (${tasks.map(() => "?").join(",")})`,
    ...tasks.map((t) => t.id));
  for (const m of marks) {
    const key = `${m.userId}|${m.day}`;
    (byUserDay.get(key) ?? byUserDay.set(key, new Set()).get(key)).add(index.get(m.taskId));
  }
  const weight = new Map();
  for (const set of byUserDay.values()) {
    const list = [...set].sort((a, b) => a - b);
    for (let a = 0; a < list.length; a += 1)
      for (let b = a + 1; b < list.length; b += 1) {
        const key = `${list[a]}|${list[b]}`;
        weight.set(key, (weight.get(key) ?? 0) + 1);
      }
  }
  return [...weight.entries()].map(([k, w]) => {
    const [i, j] = k.split("|").map(Number);
    return [i, j, w];
  });
}

export async function taskDetail(db, user, taskId) {
  const per = taskPerimeter(user);
  const row = await db.get(`
    SELECT t.id, t.title, t.description, t.kind, t.createdAt, t.closedAt, t.dueDate,
           p.name AS project, ts.name AS status,
           ua.nickName AS aNick, ua.name AS aName, us.nickName AS sNick, us.name AS sName,
           (SELECT COUNT(*) FROM Comment c WHERE c.taskId = t.id) AS comments,
           (SELECT COUNT(*) FROM TaskAttachment ta WHERE ta.taskId = t.id) AS attachments,
           (SELECT ROUND(SUM(e.hours), 1) FROM TimeEntry e WHERE e.taskId = t.id) AS hours
    FROM Task t
    LEFT JOIN Project p ON p.id = t.projectId
    LEFT JOIN TaskStatus ts ON ts.id = t.statusId
    LEFT JOIN User ua ON ua.id = t.assigneeId
    LEFT JOIN User us ON us.id = t.supervisorId
    WHERE t.id = ? AND ${per.where}`, taskId, ...per.params);
  if (!row) return null;
  return {
    id: row.id, title: stripHtml(row.title), text: stripHtml(row.description).slice(0, 1200),
    kind: row.kind, project: row.project, status: row.status,
    assignee: row.aNick || row.aName || null, supervisor: row.sNick || row.sName || null,
    createdAt: row.createdAt?.slice(0, 10) ?? null, closedAt: row.closedAt?.slice(0, 10) ?? null,
    dueDate: row.dueDate?.slice(0, 10) ?? null,
    comments: row.comments, attachments: row.attachments, hours: row.hours,
  };
}
