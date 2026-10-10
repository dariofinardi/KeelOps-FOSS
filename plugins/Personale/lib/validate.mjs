// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Input validation, the same rules the core enforced with zod in
 * `packages/shared/src/schemas/boards.ts` — written out here because a plugin
 * has no dependencies (the core's copy goes away with the core's boards).
 * Messages are what the user reads, so they stay in Italian.
 */

export class HttpError extends Error {
  constructor(status, message, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, message, "VALIDATION_ERROR");
export const notFound = (message) => new HttpError(404, message, "NOT_FOUND");
export const conflict = (message) => new HttpError(409, message, "CONFLICT");

export const TEMPLATE_KEYS = ["empty", "review", "gtd", "eisenhower", "week"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (value, field, { min = 0, max, nullable = false } = {}) => {
  if (value === undefined) return undefined;
  if (value === null) {
    if (nullable) return null;
    throw badRequest(`${field}: valore mancante`);
  }
  if (typeof value !== "string") throw badRequest(`${field}: testo atteso`);
  if (value.length < min) throw badRequest(`${field}: troppo corto`);
  if (max !== undefined && value.length > max) throw badRequest(`${field}: troppo lungo (max ${max})`);
  return value;
};

const idOrNull = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 191) {
    throw badRequest(`${field}: identificativo non valido`);
  }
  return value;
};

export function validateCreateBoard(body) {
  const name = text(body?.name, "name", { min: 1, max: 100 });
  if (name === undefined) throw badRequest("name: valore mancante");
  const template = body?.template === undefined ? "empty" : body.template;
  if (!TEMPLATE_KEYS.includes(template)) throw badRequest("Template sconosciuto");
  return { name, template };
}

export function validateUpdateBoard(body) {
  const name = text(body?.name, "name", { min: 1, max: 100 });
  if (name === undefined) throw badRequest("name: valore mancante");
  return { name };
}

/**
 * The full set of a board's columns, replaced at once: exactly one initial,
 * at least one closed, initial never closed, distinct names.
 */
export function validateStatuses(body) {
  const statuses = body?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) throw badRequest("Serve almeno uno stato");
  const cleaned = statuses.map((s) => ({
    id: idOrNull(s?.id, "id") ?? undefined,
    name: text(s?.name, "name", { min: 1, max: 60 }),
    color: text(s?.color, "color", { min: 1, max: 20 }),
    isInitial: Boolean(s?.isInitial),
    isClosed: Boolean(s?.isClosed),
  }));
  for (const s of cleaned) {
    if (s.name === undefined || s.color === undefined) throw badRequest("Ogni stato vuole nome e colore");
  }
  if (cleaned.filter((s) => s.isInitial).length !== 1) throw badRequest("Serve esattamente uno stato iniziale");
  if (!cleaned.some((s) => s.isClosed)) throw badRequest("Serve almeno uno stato di chiusura");
  if (cleaned.some((s) => s.isInitial && s.isClosed)) {
    throw badRequest("Lo stato iniziale non può essere anche di chiusura");
  }
  if (new Set(cleaned.map((s) => s.name.trim().toLowerCase())).size !== cleaned.length) {
    throw badRequest("Gli stati devono avere nomi distinti");
  }
  return cleaned;
}

export function validateReorder(body) {
  const order = body?.order;
  if (!Array.isArray(order) || order.length > 200 || order.some((id) => typeof id !== "string")) {
    throw badRequest("order: elenco di identificativi atteso");
  }
  return order;
}

const dueDate = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value)) throw badRequest("Data non valida");
  return value;
};

const dueTime = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !TIME.test(value)) throw badRequest("Orario non valido");
  return value;
};

export function validateCreateTask(body) {
  const title = text(body?.title, "title", { min: 1, max: 300 });
  if (title === undefined) throw badRequest("title: valore mancante");
  return {
    title,
    description: text(body?.description, "description", { max: 20000, nullable: true }) ?? null,
    statusId: idOrNull(body?.boardStatusId ?? body?.statusId, "statusId") ?? undefined,
    assigneeId: idOrNull(body?.assigneeId, "assigneeId"),
    supervisorId: idOrNull(body?.supervisorId, "supervisorId"),
    dueDate: dueDate(body?.dueDate) ?? null,
    dueTime: dueTime(body?.dueTime) ?? null,
  };
}

export function validateUpdateTask(body) {
  const out = {
    title: text(body?.title, "title", { min: 1, max: 300 }),
    description: text(body?.description, "description", { max: 20000, nullable: true }),
    statusId: idOrNull(body?.boardStatusId ?? body?.statusId, "statusId") ?? undefined,
    assigneeId: idOrNull(body?.assigneeId, "assigneeId"),
    supervisorId: idOrNull(body?.supervisorId, "supervisorId"),
    dueDate: dueDate(body?.dueDate),
    dueTime: dueTime(body?.dueTime),
    archived: body?.archived === undefined ? undefined : Boolean(body.archived),
  };
  return out;
}
