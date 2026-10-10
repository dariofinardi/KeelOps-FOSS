// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which tables a statement WRITES — the one question the plugin database layer
 * has to answer before it lets a write through.
 *
 * A plugin owns the tables that carry its prefix (`plugin_<nick>_…`) and
 * nothing else. The old guard was a regex on the first word: `SELECT` or
 * `WITH` passed, anything else failed. It was enough while nothing could write,
 * and it is not enough now: `WITH x AS (SELECT 1) DELETE FROM Task` begins with
 * `WITH` and is a perfectly valid SQLite statement.
 *
 * This is not an SQL parser and does not try to be one. It strips comments and
 * string literals, then walks the tokens looking for the few shapes that name
 * a write target:
 *
 *   INSERT [OR …] INTO t        UPDATE [OR …] t          DELETE FROM t
 *   REPLACE INTO t              TRUNCATE [TABLE] t
 *   CREATE [TEMP] TABLE [IF NOT EXISTS] t     ALTER TABLE t      DROP TABLE [IF EXISTS] t
 *   CREATE [UNIQUE] INDEX [IF NOT EXISTS] i ON t          DROP INDEX [IF EXISTS] i [ON t]
 *   CREATE VIEW / TRIGGER / …  → refused outright (a plugin has no business there)
 *
 * Anything it cannot classify with confidence is a refusal, never a pass:
 * the cost of a false "no" is an error message a developer reads; the cost
 * of a false "yes" is a plugin writing into the core's tables.
 */

/** Tokens the walker looks at: words, quoted identifiers, and punctuation it cares about. */
const TOKEN = /`(?:[^`]|``)+`|"(?:[^"]|"")+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*|;|\(|\)|\./g;

/**
 * Removes what must not be read as SQL: line (`--`) and block comments, and the
 * contents of string literals — a table name inside quotes is data, not a target.
 * Unterminated literals or comments are an error: better to refuse than to guess
 * where the statement really ends.
 */
export function stripCommentsAndStrings(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated comment");
      i = end + 2;
      out += " ";
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error("unterminated string literal");
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "\\" && j + 1 < sql.length) { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += "''";
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const unquote = (token) => {
  if (token.startsWith("`")) return token.slice(1, -1).replace(/``/g, "`");
  if (token.startsWith('"')) return token.slice(1, -1).replace(/""/g, '"');
  if (token.startsWith("[")) return token.slice(1, -1);
  return token;
};

const isWord = (token) => /^[A-Za-z_]/.test(token) || /^[`"[]/.test(token);

/**
 * A (possibly schema-qualified) name at position `i`: `t`, `main.t`, `"t"`.
 * Returns the bare table name and the index just past it.
 */
const readName = (tokens, i) => {
  if (i >= tokens.length || !isWord(tokens[i])) return null;
  let name = unquote(tokens[i]);
  let j = i + 1;
  while (tokens[j] === "." && j + 1 < tokens.length && isWord(tokens[j + 1])) {
    name = unquote(tokens[j + 1]);
    j += 2;
  }
  return { name, next: j };
};

const skipWords = (tokens, i, ...sequences) => {
  for (const seq of sequences) {
    const words = seq.split(" ");
    if (words.every((w, k) => (tokens[i + k] ?? "").toUpperCase() === w)) return i + words.length;
  }
  return i;
};

/**
 * @returns {{ tables: string[], indexes: string[], statements: number }}
 *   the tables written, the indexes created or dropped, and how many
 *   statements the text contains.
 */
export function writeTargets(sql) {
  const tokens = stripCommentsAndStrings(sql).match(TOKEN) ?? [];
  const tables = new Set();
  const indexes = new Set();
  let statements = tokens.length > 0 ? 1 : 0;
  const upper = tokens.map((t) => (isWord(t) && !/^[`"[]/.test(t) ? t.toUpperCase() : t));

  for (let i = 0; i < tokens.length; i += 1) {
    const w = upper[i];
    if (w === ";") {
      if (i < tokens.length - 1) statements += 1;
      continue;
    }
    if (w === "INSERT" || w === "REPLACE") {
      let j = i + 1;
      if (upper[j] === "OR") j += 2;            // INSERT OR REPLACE / IGNORE …
      if (upper[j] === "INTO") j += 1;
      const name = readName(tokens, j);
      if (!name) throw new Error(`cannot tell what ${w} writes`);
      tables.add(name.name);
      continue;
    }
    if (w === "UPDATE") {
      // The UPDATE inside an upsert clause updates the table already named by
      // the INSERT: `… ON CONFLICT(k) DO UPDATE SET …` (SQLite) and
      // `… ON DUPLICATE KEY UPDATE …` (MySQL). Not a new target. Neither is
      // the referential action of a foreign key: `… ON UPDATE CASCADE`.
      if (upper[i - 1] === "DO" || upper[i - 1] === "KEY" || upper[i - 1] === "ON") continue;
      let j = i + 1;
      if (upper[j] === "OR") j += 2;
      j = skipWords(upper, j, "LOW_PRIORITY", "IGNORE");
      const name = readName(tokens, j);
      if (!name) throw new Error("cannot tell what UPDATE writes");
      tables.add(name.name);
      continue;
    }
    if (w === "DELETE") {
      // `FOREIGN KEY (…) REFERENCES t(id) ON DELETE CASCADE`: a referential
      // action inside a CREATE TABLE, not a statement that deletes.
      if (upper[i - 1] === "ON") continue;
      let j = i + 1;
      j = skipWords(upper, j, "LOW_PRIORITY", "QUICK", "IGNORE");
      if (upper[j] !== "FROM") throw new Error("cannot tell what DELETE writes");
      const name = readName(tokens, j + 1);
      if (!name) throw new Error("cannot tell what DELETE writes");
      tables.add(name.name);
      continue;
    }
    if (w === "TRUNCATE") {
      let j = i + 1;
      if (upper[j] === "TABLE") j += 1;
      const name = readName(tokens, j);
      if (!name) throw new Error("cannot tell what TRUNCATE writes");
      tables.add(name.name);
      continue;
    }
    if (w === "CREATE" || w === "DROP" || w === "ALTER") {
      let j = i + 1;
      j = skipWords(upper, j, "TEMP", "TEMPORARY", "UNIQUE", "OR REPLACE");
      const kind = upper[j];
      j += 1;
      j = skipWords(upper, j, "IF NOT EXISTS", "IF EXISTS");
      if (kind === "TABLE") {
        const name = readName(tokens, j);
        if (!name) throw new Error(`cannot tell what ${w} TABLE targets`);
        tables.add(name.name);
        continue;
      }
      if (kind === "INDEX") {
        const index = readName(tokens, j);
        if (!index) throw new Error(`cannot tell what ${w} INDEX targets`);
        indexes.add(index.name);
        // CREATE INDEX i ON t — the table is a write target too
        if (upper[index.next] === "ON") {
          const on = readName(tokens, index.next + 1);
          if (!on) throw new Error("cannot tell which table the index is on");
          tables.add(on.name);
        }
        continue;
      }
      // views, triggers, procedures, databases, users…: not for a plugin
      throw new Error(`${w} ${kind ?? ""} is not allowed from a plugin`.trim());
    }
  }
  return { tables: [...tables], indexes: [...indexes], statements };
}

/**
 * The gate: every written table and every index must carry `plugin_<nick>_`,
 * one statement at a time. Throws with a message that says which name is
 * wrong — the person reading it is a developer of the plugin, and «denied»
 * alone would send them guessing.
 */
export function assertWritesOnlyOwnTables(sql, nick) {
  const prefix = `plugin_${nick}_`;
  const { tables, indexes, statements } = writeTargets(sql);
  if (statements > 1) throw new Error("one statement per call: found more than one");
  const wrong = [...tables, ...indexes].filter((name) => !name.toLowerCase().startsWith(prefix));
  if (wrong.length > 0) {
    throw new Error(
      `a plugin writes only its own tables (${prefix}…): refused ${wrong.map((n) => `"${n}"`).join(", ")}`,
    );
  }
  return { tables, indexes };
}
