import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../error-message';
import { migrate } from './migrate';
import { placeholders, serviceDb, type Db } from './service-db';

function fresh(): { db: Db; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  migrate(raw, 'migrations');
  return { db: serviceDb(raw), raw };
}

// Every SQL string literal in the server modules: the statements the adapter exists for. An interpolation stands in as
// 1, which keeps the placeholder scan honest and compiles where the fragment was a value or a condition.
function corpus(): { file: string; sql: string; interpolated: boolean }[] {
  const out: { file: string; sql: string; interpolated: boolean }[] = [];
  // account-store.ts speaks to an account's own file (db/account-db.ts), not to this database.
  for (const file of readdirSync('src/server').filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'account-store.ts')) {
    // Comment lines go first: a backtick inside one would open a template literal that swallows real statements.
    const text = readFileSync(`src/server/${file}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const match of text.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)'/g)) {
      const literal = match[1] ?? match[2]!;
      if (!/^\s*(SELECT\b|INSERT INTO\b|UPDATE \w+ SET\b|DELETE FROM\b|WITH\b)/i.test(literal)) continue;
      out.push({ file, sql: literal.replace(/\$\{[^}]*\}/g, ' 1 '), interpolated: literal.includes('${') });
    }
  }
  return out;
}

describe('the service adapter', () => {
  it('answers first, all and run as the routes read them', async () => {
    const { db } = fresh();
    expect(await db.prepare('SELECT signup_cap FROM service').first('signup_cap')).toBe(1);
    expect(await db.prepare('SELECT signup_cap, account_bytes_cap AS cap FROM service').first()).toEqual({ signup_cap: 1, cap: null });
    expect(await db.prepare('SELECT 1 FROM accounts').first()).toBeNull();
    expect(await db.prepare('SELECT id FROM accounts').first('id')).toBeNull();
    const ran = await db.prepare("INSERT INTO file_blocks (id, blocked_at) VALUES (?, ?)").bind('a', 1).run();
    expect(ran.meta.changes).toBe(1);
    expect(await db.prepare('SELECT id, blocked_at FROM file_blocks').all()).toEqual({ results: [{ id: 'a', blocked_at: 1 }], meta: { changes: 0 } });
    expect(await db.prepare('DELETE FROM file_blocks WHERE id = ?').bind('none').run()).toEqual({ results: [], meta: { changes: 0 } });
  });

  it('reads RETURNING rows with their change count, and a plain DML answers null to first()', async () => {
    const { db } = fresh();
    const inserted = await db.prepare("INSERT INTO reports (account_id, username, text, created_at) VALUES ('a', 'a', 't', 1) RETURNING id").first<number>('id');
    expect(inserted).toBe(1);
    const [updated] = await db.batch<{ id: number }>([db.prepare('UPDATE reports SET resolved_at = 2 WHERE account_id = ? RETURNING id').bind('a')]);
    expect(updated).toEqual({ results: [{ id: 1 }], meta: { changes: 1 } });
    expect(await db.prepare('UPDATE reports SET resolved_at = 3').first()).toBeNull();
  });

  it('binds ?N positionally, repeated and out of order, and refuses a statement mixing the two styles', async () => {
    const { db } = fresh();
    expect((await db.prepare('SELECT ?2 AS a, ?1 AS b, ?1 AS c').bind('one', 'two').all()).results).toEqual([{ a: 'two', b: 'one', c: 'one' }]);
    await expect(db.prepare('SELECT ?1 AS a, ? AS b').bind(1, 2).all()).rejects.toThrow(/mixes/);
    expect(placeholders("SELECT '?1' AS a, ? AS b -- ?2").mixed).toBe(false);
  });

  it('bind() answers a new statement and leaves the one it was called on', async () => {
    const { db } = fresh();
    const base = db.prepare('SELECT ? AS v');
    const one = base.bind(1);
    const two = base.bind(2);
    expect(one).not.toBe(two);
    expect(await one.first('v')).toBe(1);
    expect(await two.first('v')).toBe(2);
  });

  it('runs a batch as one transaction whose changes() gate sees the statement before, through a RETURNING statement', async () => {
    const { db, raw } = fresh();
    const now = 1;
    // The signup's shape: the account insert answers its row, the vault and the session are gated on the insert, the
    // operator claim on the session, and the last statement reads.
    const signup = (id: string, username: string) =>
      db.batch<{ incarnation?: string; open?: number }>([
        db
          .prepare(
            `INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) SELECT ?1, ?2, 'h', ?3, ?4, ?5
             WHERE (SELECT COUNT(*) FROM accounts) < (SELECT signup_cap FROM service) AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = ?1 OR username = ?2) RETURNING incarnation`,
          )
          .bind(id, username, now, `inc-${id}`, `tl-${id}`),
        db.prepare("INSERT INTO vaults (account_id, password_wrap, recovery_wrap, recovery_hash, created_at, updated_at) SELECT ?, 'p', 'r', 'h', ?, ? WHERE changes() = 1").bind(id, now, now),
        db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) SELECT ?, ?, ? WHERE changes() = 1').bind(`t-${id}`, id, 2),
        db.prepare('UPDATE installation SET operator_account = ?1 WHERE id = 1 AND operator_account IS NULL AND changes() = 1').bind(id),
        db.prepare('SELECT (SELECT COUNT(*) FROM accounts) < (SELECT signup_cap FROM service) AS open'),
      ]);
    const [created, vault, session, claim, room] = await signup('a', 'jin');
    expect(created!.results).toEqual([{ incarnation: 'inc-a' }]);
    expect([vault!.meta.changes, session!.meta.changes, claim!.meta.changes]).toEqual([1, 1, 1]);
    expect(room!.results[0]!.open).toBe(0);
    const [refused, noVault, noSession, noClaim] = await signup('b', 'other');
    expect(refused!.results).toEqual([]);
    expect([noVault!.meta.changes, noSession!.meta.changes, noClaim!.meta.changes]).toEqual([0, 0, 0]);
    expect(raw.prepare('SELECT operator_account FROM installation').get()).toMatchObject({ operator_account: 'a' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM vaults').get()).toMatchObject({ n: 1 });
  });

  it('rolls a batch back whole when a statement fails', async () => {
    const { db, raw } = fresh();
    await expect(
      db.batch([db.prepare("INSERT INTO file_blocks (id, blocked_at) VALUES ('a', 1)"), db.prepare('INSERT INTO nowhere VALUES (1)')]),
    ).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM file_blocks').get()).toMatchObject({ n: 0 });
  });

  it("keeps the server's own statements to one placeholder style each, and compiles the uninterpolated ones against the shipped schema", () => {
    const statements = corpus();
    expect(statements.length).toBeGreaterThan(60);
    const { raw } = fresh();
    const mixed = statements.filter(({ sql }) => placeholders(sql).mixed).map(({ file, sql }) => `${file}: ${sql.trim().slice(0, 60)}`);
    expect(mixed).toEqual([]);
    const failed = statements
      .filter(({ interpolated }) => !interpolated)
      .flatMap(({ file, sql }) => {
        try {
          raw.prepare(sql);
          return [];
        } catch (error) {
          return [`${file}: ${sql.trim().slice(0, 60)} → ${errorMessage(error)}`];
        }
      });
    expect(failed).toEqual([]);
  });
});
