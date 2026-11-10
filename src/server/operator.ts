import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { LogAction, LogDetails } from '../contracts/admin';
import type { Db, SqlValue, Statement } from './db/service-db';
import { fail, type AppEnv } from './http';

export const operator = createMiddleware<AppEnv>(async (c, next) => (c.get('account').admin ? next() : fail(c, 403, 'not-admin')));

// The last statement is the action, and answers the row it wrote.
export async function act(c: Context<AppEnv>, ...statements: Statement[]) {
  const done = await c.env.db.batch(statements);
  return done.at(-1)!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
}

// Each detail field as SQL over the row's source, in the order the stored JSON keeps.
type DetailSql<A extends LogAction> = LogDetails[A] extends null ? null : { [K in keyof NonNullable<LogDetails[A]>]: string };
// A row whose target is the id of each row `from` (FROM … WHERE …) selects: written only while its target is there.
type Read<A extends LogAction> = { from: string; detail: DetailSql<A> };
type Fixed<A extends LogAction> = { target: 'service' | 'everyone'; detail: LogDetails[A] };

// The one writer of admin_log, its row put in the batch of the action it names: logged before the action, since a
// deletion would leave no target to read. A read row binds at to ?1 and values from ?2 on.
export function logged<A extends LogAction>(db: Db, at: number, action: A, row: Read<A> | Fixed<A>, ...values: SqlValue[]): Statement {
  if ('target' in row) {
    return db.prepare(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, '${action}', ?, ?)`).bind(at, row.target, row.detail === null ? null : JSON.stringify(row.detail));
  }
  const detail = row.detail === null ? 'NULL' : `json_object(${Object.entries(row.detail).map(([key, sql]) => `'${key}', ${sql as string}`).join(', ')})`;
  return db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?1, '${action}', id, ${detail} FROM ${row.from}`).bind(at, ...values);
}
