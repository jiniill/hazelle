import { backup, DatabaseSync } from 'node:sqlite';
import { transaction } from './transaction';

// Keep the existing route SQL contract over node:sqlite: bound prepare/first/all/run and atomic batch.

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;
export type Result<T = Row> = { results: T[]; meta: { changes: number } };

export type Statement = {
  // A new statement each time: callers hold statements by identity.
  bind(...values: SqlValue[]): Statement;
  first<T = Row>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Row>(): Promise<Result<T>>;
  run(): Promise<Result<never>>;
};

export type Db = {
  prepare(sql: string): Statement;
  snapshot(path: string): Promise<void>;
  // Keep BEGIN IMMEDIATE through COMMIT synchronous: changes() gates the next signup/reservation/deletion statement.
  batch<T = Row>(statements: Statement[]): Promise<Result<T>[]>;
};

const EXECUTE = Symbol('execute');
type Internal = Statement & { [EXECUTE]<T>(): Result<T> };

// Use WAL, foreign keys and FULL durability by default: lifecycle relies on acknowledged service commits
// surviving before account-file deletion.
export function openDatabase(path: string, synchronous: 'FULL' | 'NORMAL' = 'FULL'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA synchronous = ${synchronous}`);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function serviceDb(db: DatabaseSync): Db {
  const statement = (sql: string, values: SqlValue[]): Internal => {
    const execute = <T>(): Result<T> => {
      const shape = placeholders(sql);
      if (shape.mixed) throw new Error(`A statement mixes ? and ?N placeholders: ${sql.trim().slice(0, 80)}`);
      // all() for every statement: a DML without RETURNING answers no rows, and changes() read right after it is
      // its count. A SELECT leaves changes() at the previous DML's count, which no caller reads.
      const results = db.prepare(sql).all(...values).map((row) => ({ ...row })) as T[];
      const changes = shape.reads ? 0 : (db.prepare('SELECT changes() AS n').get() as { n: number }).n;
      return { results, meta: { changes } };
    };
    return {
      [EXECUTE]: execute,
      bind: (...next) => statement(sql, next),
      first: async <T>(column?: string) => {
        const row = execute<Row>().results[0];
        if (row === undefined) return null;
        return (column === undefined ? row : (row[column] ?? null)) as T | null;
      },
      all: async <T>() => execute<T>(),
      run: async () => execute<never>(),
    };
  };
  return {
    prepare: (sql) => statement(sql, []),
    snapshot: async (path) => { await backup(db, path); },
    batch: async <T>(statements: Statement[]) => transaction(db, () => statements.map((s) => (s as Internal)[EXECUTE]<T>())),
  };
}

// The SQL with its string literals and comments blanked, so a ? or a keyword inside them is not read as syntax.
function bare(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
}

export function placeholders(sql: string): { mixed: boolean; reads: boolean } {
  const text = bare(sql);
  const numbered = /\?\d/.test(text);
  const anonymous = /\?(?!\d)/.test(text);
  const reads = /^\s*(SELECT|WITH)\b/i.test(text);
  return { mixed: numbered && anonymous, reads };
}
