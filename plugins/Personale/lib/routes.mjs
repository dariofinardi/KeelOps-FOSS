/**
 * The routes, independent of HOW the plugin is served: the core uses them when
 * the plugin is side-loaded, `server.mjs` in standalone mode. Same shapes as
 * the core's `/api/boards*` used to have, so the UI moved with them.
 *
 * ctx: { db, keelopsUrl, version, sessionUser(req) } — `sessionUser` may be
 * async (in the core it is: it goes through Prisma). Every route asks for the
 * user first: a personal board is nobody's business but its owner's.
 */
import { json, readJson } from "../../keelops-sdk/http.mjs";
import { BASE_CSS } from "../../keelops-sdk/ui.mjs";
import { HttpError, validateCreateBoard, validateCreateTask, validateReorder, validateStatuses, validateUpdateBoard, validateUpdateTask } from "./validate.mjs";
import { createBoard, deleteBoard, listBoards, renameBoard, reorderBoards, replaceStatuses, toBoardDto } from "./boards.mjs";
import { GRUPPI, createTask, dashboardCounts, dashboardTasks, deleteTask, listTasks, updateTask } from "./tasks.mjs";

export function buildRoutes(ctx) {
  async function requireUser(req, res) {
    const user = await ctx.sessionUser(req);
    if (!user) {
      json(res, 401, { errore: "serve una sessione KeelOps attiva", accedi: ctx.keelopsUrl ? `${ctx.keelopsUrl}/login` : null });
      return null;
    }
    return user;
  }

  /** Runs a handler and turns its errors into the JSON the UI expects. */
  const guarded = (handler) => async (req, res, match, url) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await handler(user, req, res, match, url);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { errore: err.message, codice: err.code });
      if (err instanceof SyntaxError) return json(res, 400, { errore: "corpo JSON non valido", codice: "VALIDATION_ERROR" });
      throw err;
    }
  };

  const body = async (req) => (await readJson(req)) ?? {};

  return [
    ["GET", /^\/base\.css$/, (req, res) => {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(BASE_CSS);
    }],
    ["GET", /^\/health$/, (req, res) => json(res, 200, { ok: true, plugin: "Personale", versione: ctx.version })],

    // ── boards ──
    ["GET", /^\/api\/boards$/, guarded(async (user, req, res) => {
      json(res, 200, { boards: (await listBoards(ctx.db, user)).map(toBoardDto) });
    })],
    ["POST", /^\/api\/boards$/, guarded(async (user, req, res) => {
      const input = validateCreateBoard(await body(req));
      json(res, 201, toBoardDto(await createBoard(ctx.db, user, input)));
    })],
    ["PUT", /^\/api\/boards\/order$/, guarded(async (user, req, res) => {
      const order = validateReorder(await body(req));
      json(res, 200, { boards: (await reorderBoards(ctx.db, user, order)).map(toBoardDto) });
    })],
    ["PATCH", /^\/api\/boards\/([^/]+)$/, guarded(async (user, req, res, m) => {
      const input = validateUpdateBoard(await body(req));
      json(res, 200, toBoardDto(await renameBoard(ctx.db, user, m[1], input.name)));
    })],
    ["DELETE", /^\/api\/boards\/([^/]+)$/, guarded(async (user, req, res, m) => {
      await deleteBoard(ctx.db, user, m[1]);
      res.writeHead(204); res.end();
    })],
    ["PUT", /^\/api\/boards\/([^/]+)\/statuses$/, guarded(async (user, req, res, m) => {
      const statuses = validateStatuses(await body(req));
      json(res, 200, toBoardDto(await replaceStatuses(ctx.db, user, m[1], statuses)));
    })],

    // ── cards ──
    ["GET", /^\/api\/boards\/([^/]+)\/tasks$/, guarded(async (user, req, res, m, url) => {
      const includeArchived = url.searchParams.get("includeArchived") === "1" || url.searchParams.get("includeArchived") === "true";
      json(res, 200, { tasks: await listTasks(ctx.db, user, m[1], includeArchived) });
    })],
    ["POST", /^\/api\/boards\/([^/]+)\/tasks$/, guarded(async (user, req, res, m) => {
      const input = validateCreateTask(await body(req));
      json(res, 201, await createTask(ctx.db, user, m[1], input));
    })],
    ["PATCH", /^\/api\/boards\/([^/]+)\/tasks\/([^/]+)$/, guarded(async (user, req, res, m) => {
      const input = validateUpdateTask(await body(req));
      json(res, 200, await updateTask(ctx.db, user, m[1], m[2], input));
    })],
    ["DELETE", /^\/api\/boards\/([^/]+)\/tasks\/([^/]+)$/, guarded(async (user, req, res, m) => {
      await deleteTask(ctx.db, user, m[1], m[2]);
      res.writeHead(204); res.end();
    })],

    // ── the people a card can be given to: internal and active, like the core's options ──
    ["GET", /^\/api\/utenti$/, guarded(async (user, req, res) => {
      const rows = await ctx.db.all(
        `SELECT id, name FROM User WHERE isActive = 1 AND isSystem = 0 AND role IN ('ADMIN', 'MEMBER') ORDER BY name`,
      );
      json(res, 200, { users: rows.map((r) => ({ id: r.id, name: r.name })) });
    })],

    // ── what the dashboard tile shows ──
    ["GET", /^\/api\/dashboard$/, guarded(async (user, req, res, m, url) => {
      const gruppo = url.searchParams.get("gruppo");
      if (gruppo !== null && !GRUPPI.includes(gruppo)) return json(res, 400, { errore: `gruppo sconosciuto: ${gruppo}`, codice: "VALIDATION_ERROR" });
      json(res, 200, { tasks: await dashboardTasks(ctx.db, user, { gruppo }), me: { id: user.id, name: user.name } });
    })],
    // the numbers on the «Personali» chips of the dashboard groups (contract: anchors.dashboardGroups)
    ["GET", /^\/api\/gruppi$/, guarded(async (user, req, res) => {
      json(res, 200, { gruppi: await dashboardCounts(ctx.db, user) });
    })],
  ];
}
