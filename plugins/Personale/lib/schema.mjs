/**
 * The plugin's tables and how they got there.
 *
 * Six tables, all `plugin_personale_*`: the configuration one the core reads
 * first (`plugin_personale_config`, created by the SDK), then owners, boards,
 * statuses (the columns), tasks, activity. The DDL is one text for both engines:
 * `VARCHAR`, `TEXT`, `INTEGER` mean the same on SQLite and MariaDB, dates are
 * ISO strings (never DATETIME — the switch script copies rows verbatim), and
 * the only dialect corner is the table suffix (charset on MariaDB, nothing on
 * SQLite), which a foreign key to `User` needs to match.
 *
 * Foreign keys point one way only: from here to the core (`User`), never the
 * other way — a disabled plugin must not break a deletion in the core.
 * `ON DELETE CASCADE` on the owner: a user gone takes their boards along, as
 * the core's `Board.ownerId` did. `RESTRICT` from task to status: a column
 * with tasks in it cannot be deleted, and the rule lives in the database too.
 */
import { applyMigrations } from "../../keelops-sdk/database.mjs";

export const NICK = "personale";
export const SCHEMA_VERSION = 1;

const ID = "VARCHAR(191) NOT NULL";
const ISO = "VARCHAR(32)";

export function ddlV1(sql) {
  const suffix = sql.createTableSuffix();
  return [
    `CREATE TABLE IF NOT EXISTS plugin_personale_owner (
      userId ${ID} PRIMARY KEY,
      initializedAt ${ISO} NOT NULL,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )${suffix}`,
    `CREATE TABLE IF NOT EXISTS plugin_personale_board (
      id ${ID} PRIMARY KEY,
      ownerId ${ID},
      name VARCHAR(100) NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      createdAt ${ISO} NOT NULL,
      updatedAt ${ISO} NOT NULL,
      FOREIGN KEY (ownerId) REFERENCES User(id) ON DELETE CASCADE,
      UNIQUE (ownerId, name)
    )${suffix}`,
    `CREATE TABLE IF NOT EXISTS plugin_personale_status (
      id ${ID} PRIMARY KEY,
      boardId ${ID},
      name VARCHAR(60) NOT NULL,
      color VARCHAR(20) NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      isInitial INTEGER NOT NULL DEFAULT 0,
      isClosed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (boardId) REFERENCES plugin_personale_board(id) ON DELETE CASCADE,
      UNIQUE (boardId, name)
    )${suffix}`,
    `CREATE TABLE IF NOT EXISTS plugin_personale_task (
      id ${ID} PRIMARY KEY,
      boardId ${ID},
      statusId ${ID},
      creatorId ${ID},
      assigneeId VARCHAR(191) NULL,
      supervisorId VARCHAR(191) NULL,
      title VARCHAR(300) NOT NULL,
      description TEXT NULL,
      dueDate VARCHAR(10) NULL,
      dueTime VARCHAR(5) NULL,
      position INTEGER NOT NULL DEFAULT 0,
      createdAt ${ISO} NOT NULL,
      updatedAt ${ISO} NOT NULL,
      closedAt ${ISO} NULL,
      archivedAt ${ISO} NULL,
      FOREIGN KEY (boardId) REFERENCES plugin_personale_board(id) ON DELETE CASCADE,
      FOREIGN KEY (statusId) REFERENCES plugin_personale_status(id) ON DELETE RESTRICT,
      FOREIGN KEY (creatorId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (assigneeId) REFERENCES User(id) ON DELETE SET NULL,
      FOREIGN KEY (supervisorId) REFERENCES User(id) ON DELETE SET NULL
    )${suffix}`,
    `CREATE TABLE IF NOT EXISTS plugin_personale_activity (
      id ${ID} PRIMARY KEY,
      taskId ${ID},
      userId ${ID},
      action VARCHAR(64) NOT NULL,
      payload TEXT NULL,
      createdAt ${ISO} NOT NULL,
      FOREIGN KEY (taskId) REFERENCES plugin_personale_task(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )${suffix}`,
    `CREATE INDEX plugin_personale_board_owner ON plugin_personale_board (ownerId, position)`,
    `CREATE INDEX plugin_personale_status_board ON plugin_personale_status (boardId, position)`,
    `CREATE INDEX plugin_personale_task_board ON plugin_personale_task (boardId, createdAt)`,
    `CREATE INDEX plugin_personale_task_assignee ON plugin_personale_task (assigneeId, archivedAt)`,
    `CREATE INDEX plugin_personale_activity_task ON plugin_personale_activity (taskId, createdAt)`,
  ];
}

/** The steps, in order; each writes `schema_version` when it completes. */
export const MIGRATIONS = [
  {
    version: 1,
    async up(db) {
      for (const statement of ddlV1(db.sql)) await db.run(statement);
    },
  },
];

export function migrate(db, from) {
  return applyMigrations(db, NICK, MIGRATIONS, from);
}
