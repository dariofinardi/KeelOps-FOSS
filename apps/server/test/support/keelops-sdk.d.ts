/**
 * I moduli dell'SDK dei plugin sono JavaScript nudo (`.mjs`) fuori dal grafo
 * TypeScript: qui ci sono le firme di quelli che i test importano, quel tanto
 * che basta a chiamarli con i tipi giusti. Il contratto vero resta nei file.
 */
declare module "*/keelops-sdk/sql-targets.mjs" {
  export function stripCommentsAndStrings(sql: string): string;
  export function writeTargets(sql: string): {
    tables: string[];
    indexes: string[];
    statements: number;
  };
  export function assertWritesOnlyOwnTables(
    sql: string,
    nick: string,
  ): { tables: string[]; indexes: string[] };
}

declare module "*/keelops-sdk/database.mjs" {
  /** Un `query(sql, params)` sul file SQLite aperto in sola lettura (vedi V3). */
  export function readOnlyQuery(path: string): (sql: string, params?: unknown[]) => unknown[];
}
