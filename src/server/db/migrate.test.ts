import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const dir = (files: Record<string, string>) => {
  const path = mkdtempSync(join(tmpdir(), 'hazelle-migrations-'));
  dirs.push(path);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(path, name), sql);
  return path;
};
// The shipped migrations before `bound`, for a test of one whose objects a later migration drops.
const before = (bound: string) => dir(Object.fromEntries(readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < bound).map((name) => [name, readFileSync(join('migrations', name), 'utf8')])));
const ledger = (db: DatabaseSync) => (db.prepare('SELECT name FROM migrations ORDER BY rowid').all() as { name: string }[]).map(({ name }) => name);
const tables = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'migrations' ORDER BY name").all() as { name: string }[]).map(({ name }) => name);

describe('the migration runner', () => {
  it('adds daily visit totals to an existing installation without changing its accounts or guest pulse rows', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const earlier = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0021_visits.sql').sort();
      migrate(db, dir(Object.fromEntries(earlier.map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
      db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'existing', 'hash', 1, 'inc', 'timeline');
        INSERT INTO pulse_guest_seen (week, account) VALUES (1, 'a');
        INSERT INTO pulse_guest_replies (hour, key, type, account, name, replies) VALUES (0, '', 'direct', 'a', NULL, 1)`);
      expect(migrate(db, before('0027')).applied).toEqual(['0021_visits.sql', '0022_remote_pulse.sql', '0023_self_host_caps.sql', '0024_backup_folder.sql', '0025_pulse_week_below.sql', '0026_pulse_days.sql']);
      expect(db.prepare('SELECT id, username FROM accounts').all()).toEqual([{ id: 'a', username: 'existing' }]);
      expect(db.prepare('SELECT day, account FROM pulse_people_seen').all()).toEqual([{ day: 1, account: 'a' }]);
      expect(db.prepare('SELECT accounts, converted, guests FROM visit_days').all()).toEqual([{ accounts: 1, converted: 1, guests: 1 }]);
      expect(['visit_days', 'visit_keys', 'visit_hashes'].every((name) => tables(db).includes(name))).toBe(true);
      expect(migrate(db, before('0027')).applied).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps an existing installation's daily guests and leaves forwarded self-host replies out of them", () => {
    const db = new DatabaseSync(':memory:');
    try {
      const earlier = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0022_remote_pulse.sql').sort();
      migrate(db, dir(Object.fromEntries(earlier.map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
      const reply = db.prepare("INSERT INTO pulse_guest_replies (hour, key, type, account, name, replies) VALUES (0, '', 'direct', ?, NULL, 1)");
      reply.run('guest');
      expect(migrate(db, before('0027')).applied).toEqual(['0022_remote_pulse.sql', '0023_self_host_caps.sql', '0024_backup_folder.sql', '0025_pulse_week_below.sql', '0026_pulse_days.sql']);
      reply.run('remote:self-host');
      expect(db.prepare('SELECT guests FROM visit_days').all()).toEqual([{ guests: 1 }]);
      reply.run('another');
      expect(db.prepare('SELECT guests FROM visit_days').all()).toEqual([{ guests: 2 }]);
    } finally {
      db.close();
    }
  });

  it("drops the seeded account caps on an installation that admits one account and keeps a larger one's", () => {
    const earlier = Object.fromEntries(readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0023').map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]));
    const caps = (signupCap: number) => {
      const db = new DatabaseSync(':memory:');
      try {
        migrate(db, dir(earlier));
        db.prepare('UPDATE service SET signup_cap = ?').run(signupCap);
        expect(migrate(db, 'migrations').applied).toEqual(['0023_self_host_caps.sql', '0024_backup_folder.sql', '0025_pulse_week_below.sql', '0026_pulse_days.sql', '0027_accounts_only_pulse.sql', '0028_models_dev_tools.sql', '0029_guest_steps_and_cohorts.sql', '0030_auto_diagnoses.sql', '0031_post_pictures.sql']);
        return db.prepare('SELECT account_bytes_cap AS bytes, account_file_bytes_cap AS files FROM service').get();
      } finally {
        db.close();
      }
    };
    expect(caps(1)).toEqual({ bytes: null, files: null });
    expect(caps(192)).toEqual({ bytes: 300_000_000, files: 3_000_000_000 });
  });

  it('applies the shipped baseline to an empty database, and a restart applies nothing more', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db, 'migrations').applied).toEqual(readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort());
    expect(migrate(db, 'migrations').applied).toEqual([]);
    expect(tables(db)).toContain('installation');
    expect(db.prepare('SELECT signup_cap, account_bytes_cap, account_file_bytes_cap FROM service').get()).toEqual({ signup_cap: 1, account_bytes_cap: null, account_file_bytes_cap: null });
  });

  it('moves stored prices to the models.dev list and asks for the list again', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, dir({ '0001_baseline.sql': readFileSync('migrations/0001_baseline.sql', 'utf8') }));
    db.exec(`INSERT INTO prices VALUES ('google', 'gemini-2.5-flash', 0.3, 2.5, NULL, NULL, '[]'); UPDATE price_fetch SET fetched_at = 5, tried_at = 5`);
    expect(migrate(db, 'migrations').applied).toContain('0002_models_dev.sql');
    expect(tables(db)).not.toContain('prices');
    expect(db.prepare('SELECT COUNT(*) AS n FROM models_dev').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT fetched_at, tried_at FROM models_dev_fetch').get()).toEqual({ fetched_at: null, tried_at: null });
  });

  it('adds shares that go with their account, and keeps every report in one inbox that also takes signed-out share reports', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, dir(Object.fromEntries(['0001_baseline.sql', '0002_models_dev.sql'].map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin', 'h', 1, 'inc', 't');
      INSERT INTO reports (id, account_id, username, text, created_at) VALUES (7, 'a', 'jin', '안 열려요', 2)`);
    expect(migrate(db, dir(Object.fromEntries(['0001_baseline.sql', '0002_models_dev.sql', '0003_shares.sql'].map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')])))).applied).toEqual(['0003_shares.sql']);
    expect(db.prepare('SELECT id, account_id, username, text, share FROM reports').all()).toEqual([{ id: 7, account_id: 'a', username: 'jin', text: '안 열려요', share: null }]);
    db.exec(`INSERT INTO shares (id, incarnation, created_at) VALUES ('s', 'inc', 3);
      INSERT INTO share_versions VALUES ('s', 1, 'm', 3);
      INSERT INTO share_files VALUES ('s', 1, 'f');
      INSERT INTO reports (text, created_at, share, share_version, link) VALUES ('신고', 4, 's', 1, 'https://hazelle.app/s/s#k')`);
    expect(() => db.exec(`INSERT INTO reports (text, created_at) VALUES ('누구?', 5)`)).toThrow(/CHECK/);
    db.exec(`DELETE FROM accounts WHERE id = 'a'`);
    expect(['shares', 'share_versions', 'share_files'].map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())).toEqual([{ n: 0 }, { n: 0 }, { n: 0 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 2 });
  });

  it('lets a restore have no report, keeping its rows and never reusing an id', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, dir(Object.fromEntries(['0001_baseline.sql', '0002_models_dev.sql', '0003_shares.sql', '0004_picture_removals.sql'].map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin', 'h', 1, 'inc', 't');
      INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (4, 'inc', 7, 2, 't2', 'done', 3, 3);
      INSERT INTO restores (id, incarnation, report_id, at, timeline, phase, created_at, updated_at) VALUES (9, 'inc', 8, 2, 't3', 'done', 3, 3);
      DELETE FROM restores WHERE id = 9`);
    expect(migrate(db, 'migrations').applied).toContain('0005_self_restores.sql');
    expect(db.prepare('SELECT id, report_id, timeline FROM restores').all()).toEqual([{ id: 4, report_id: 7, timeline: 't2' }]);
    expect(db.prepare(`INSERT INTO restores (incarnation, at, timeline, phase, created_at, updated_at) VALUES ('inc', 2, 't4', 'begun', 5, 5) RETURNING id, report_id`).get()).toEqual({ id: 10, report_id: null });
    db.exec(`DELETE FROM accounts WHERE id = 'a'`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM restores').get()).toEqual({ n: 0 });
  });

  it('adds durable snapshot removals without changing or discarding the snapshot catalog', () => {
    const db = new DatabaseSync(':memory:');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0009');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(`migrations/${name}`, 'utf8')]))));
    db.exec("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256) VALUES ('s', 'i', 'baseline', 1, 2, 3, 4, 'h')");
    expect(migrate(db, 'migrations').applied).toContain('0009_snapshot_removals.sql');
    expect(db.prepare('SELECT rev, bytes, expanded, sha256 FROM snapshots').all()).toEqual([{ rev: 2, bytes: 3, expanded: 4, sha256: 'h' }]);
    db.exec("INSERT INTO snapshot_removals VALUES ('snapshots/i/s.sqlite.gz', 7); DELETE FROM snapshots WHERE id = 's'");
    expect(db.prepare('SELECT * FROM snapshot_removals').all()).toEqual([{ key: 'snapshots/i/s.sqlite.gz', due_at: 7 }]);
    db.close();
  });

  it('dates every held file’s claim at its upload, and keeps released pictures only as long as their account', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0010');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('u', 'jin', 'h', 1, 'i', 't');
      INSERT INTO account_files (incarnation, id, size, stored, created_at) VALUES ('i', 'f', 3, 1, 42)`);
    expect(migrate(db, 'migrations').applied).toContain('0010_file_removals.sql');
    expect(db.prepare('SELECT claimed_at FROM account_files').get()).toEqual({ claimed_at: 42 });
    db.exec("INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES ('i', 'g', 1, 1, 2, 3); DELETE FROM account_files; DELETE FROM accounts");
    expect(db.prepare('SELECT COUNT(*) AS n FROM file_removals').get()).toEqual({ n: 0 });
  });

  it('removes account-wide login locks from existing accounts without changing credentials or sessions', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0011');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline, failed_logins, locked_until)
      VALUES ('u', 'jin', 'password', 1, 'i', 't', 12, 9999999999999);
      INSERT INTO vaults (account_id, password_wrap, recovery_wrap, recovery_hash, created_at, updated_at)
      VALUES ('u', 'pw', 'rw', 'recovery', 1, 1);
      INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ('token', 'u', 9999999999999)`);
    const { failed_logins: failures, locked_until: lock, ...account } = db.prepare('SELECT * FROM accounts').get()!;
    expect([failures, lock]).toEqual([12, 9999999999999]);
    const vault = db.prepare('SELECT * FROM vaults').get();
    const session = db.prepare('SELECT * FROM sessions').get();
    expect(migrate(db, dir(Object.fromEntries(readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0012').map((name) => [name, readFileSync(join('migrations', name), 'utf8')])))).applied).toEqual(['0011_visitor_login_limits.sql']);
    expect(db.prepare('SELECT * FROM accounts').get()).toEqual(account);
    expect(db.prepare('SELECT * FROM vaults').get()).toEqual(vault);
    expect(db.prepare('SELECT * FROM sessions').get()).toEqual(session);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('asks for the models.dev list again for 헤이젤 나우\'s names, and drops its start once counting began', () => {
    const db = new DatabaseSync(':memory:');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0012');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO models_dev (list, model, price) VALUES ('openai', 'gpt-5', '{}'); UPDATE models_dev_fetch SET fetched_at = 5, tried_at = 5`);
    expect(migrate(db, 'migrations').applied).toContain('0012_pulse.sql');
    expect(db.prepare('SELECT model, name FROM models_dev').all()).toEqual([{ model: 'gpt-5', name: null }]);
    expect(db.prepare('SELECT fetched_at, tried_at FROM models_dev_fetch').get()).toEqual({ fetched_at: null, tried_at: null });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'pulse_start'").all()).toEqual([]);
    db.close();
  });

  it("starts 헤이젤 나우's current week and last hours again on its lists, keeping the past weeks", () => {
    const db = new DatabaseSync(':memory:');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0014');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    const week = 7 * 24 * 60 * 60 * 1000;
    const thisWeek = Date.now() - ((Date.now() - 313200000) % week);
    db.exec(`INSERT INTO pulse_week VALUES (${thisWeek}, 10), (${thisWeek - week}, 12);
      INSERT INTO pulse_week_models VALUES (${thisWeek}, 'chat', '', '', NULL, 5), (${thisWeek - week}, 'chat', '', '', NULL, 6);
      INSERT INTO pulse_hours VALUES (${thisWeek}, 'chat', 3)`);
    expect(migrate(db, 'migrations').applied).toContain('0014_pulse_lists.sql');
    expect(db.prepare('SELECT week FROM pulse_week').all()).toEqual([{ week: thisWeek - week }]);
    expect(db.prepare('SELECT people FROM pulse_week_models').all()).toEqual([{ people: 6 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pulse_hours').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('pulse_hour_replies', 'this_week')").all()).toEqual([]);
    db.close();
  });

  it("moves an account's reports to its operator-only posts under their ids and the operator's replies to its comments", () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0015');
    migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
    db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline, notices_seen) VALUES ('op', 'op', 'h', 1, 'iop', 't', 0), ('a', 'jin', 'h', 1, 'ia', 't', 0), ('b', 'bee', 'h', 1, 'ib', 't', 9);
      UPDATE installation SET operator_account = 'op';
      INSERT INTO reports (id, account_id, username, text, created_at, resolved_at, diagnostics) VALUES (7, 'a', 'jin', '그림이 안 열려요' || char(10) || '어제부터요', 2, 3, '진단');
      INSERT INTO reports (id, account_id, username, text, created_at) VALUES (8, 'gone', 'gone', '떠난 사람', 2);
      INSERT INTO reports (id, text, created_at, share, share_version, link) VALUES (9, '신고', 2, 's', 1, 'https://hazelle.app/s/s#k');
      INSERT INTO reports (id, account_id, username, text, created_at, resolved_at) VALUES (10, 'b', 'bee', '느려요', 2, 6);
      INSERT INTO notices (id, incarnation, report_id, text, created_at) VALUES (4, 'ia', 7, '고쳤어요', 3), (5, NULL, NULL, '모두에게', 4), (6, 'ia', 1, '잊힌 질문의 답', 5), (9, 'ib', 10, '봤어요', 6)`);
    const board = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0017');
    expect(migrate(db, dir(Object.fromEntries(board.map((name) => [name, readFileSync(join('migrations', name), 'utf8')])))).applied).toEqual(['0015_board.sql', '0016_notices_seen_clamp.sql']);
    expect(db.prepare('SELECT id, account_id, title, text, category, status, status_at, visibility, diagnostics FROM posts ORDER BY id').all()).toEqual([
      { id: 7, account_id: 'a', title: '그림이 안 열려요', text: '그림이 안 열려요\n어제부터요', category: 'question', status: 'seen', status_at: 3, visibility: 'operator', diagnostics: '진단' },
      { id: 8, account_id: null, title: '떠난 사람', text: '떠난 사람', category: 'question', status: 'open', status_at: null, visibility: 'operator', diagnostics: null },
      { id: 10, account_id: 'b', title: '느려요', text: '느려요', category: 'question', status: 'seen', status_at: 6, visibility: 'operator', diagnostics: null },
    ]);
    expect(db.prepare('SELECT post_id, parent_id, account_id, text, created_at FROM comments ORDER BY id').all()).toEqual([
      { post_id: 7, parent_id: null, account_id: 'op', text: '고쳤어요', created_at: 3 },
      { post_id: 10, parent_id: null, account_id: 'op', text: '봤어요', created_at: 6 },
    ]);
    expect(db.prepare('SELECT * FROM notices ORDER BY id').all()).toEqual([{ id: 5, incarnation: null, text: '모두에게', created_at: 4 }, { id: 6, incarnation: 'ia', text: '잊힌 질문의 답', created_at: 5 }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notices'").all()).toEqual([{ name: 'notices_incarnation' }]);
    expect(db.prepare('SELECT id FROM reports').all()).toEqual([{ id: 9 }]);
    // The reply it had not read stays unread on the board.
    expect(db.prepare("SELECT board_seen FROM accounts WHERE id = 'a'").get()).toEqual({ board_seen: 2 });
    // b had read its reply, the newest notice: with that notice gone, the next one must still count as unread for b.
    expect(db.prepare("SELECT notices_seen FROM accounts WHERE id = 'b'").get()).toEqual({ notices_seen: 6 });
    expect(db.prepare("INSERT INTO notices (text, created_at) VALUES ('새 소식', 7) RETURNING id").get()).toEqual({ id: 7 });
    expect(db.prepare("INSERT INTO posts (title, category, visibility, created_at) VALUES ('t', 'bug', 'public', 9) RETURNING id").get()).toEqual({ id: 11 });
    db.close();
  });

  it("moves 새 소식 to the operator's public 소식 posts, oldest first, and only where an operator exists", () => {
    const shipped = readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0017');
    const before = () => {
      const db = new DatabaseSync(':memory:');
      migrate(db, dir(Object.fromEntries(shipped.map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
      return db;
    };
    const fresh = before();
    expect(migrate(fresh, 'migrations').applied).toContain('0017_news_posts.sql');
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 0 });
    fresh.close();
    const db = before();
    db.exec("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline, notices_seen) VALUES ('op', 'op', 'h', 1, 'iop', 't', 0); UPDATE installation SET operator_account = 'op'");
    migrate(db, 'migrations');
    const posts = db.prepare("SELECT account_id, category, visibility, status, version, created_at FROM posts ORDER BY id").all() as { account_id: string; category: string; visibility: string; status: string; version: string; created_at: number }[];
    expect(posts.length).toBe(35);
    expect(posts.every((post) => post.account_id === 'op' && post.category === 'news' && post.visibility === 'public' && post.status === 'open')).toBe(true);
    expect([posts[0]!.version, posts.at(-1)!.version]).toEqual(['v0.1.77', 'v0.3.4']);
    expect(posts.every((post, index) => index === 0 || post.created_at > posts[index - 1]!.created_at)).toBe(true);
    db.close();
  });

  it('upgrades a populated database with the files it lacks, each whole or not at all', () => {
    const db = new DatabaseSync(':memory:');
    const first = dir({ '0001_a.sql': 'CREATE TABLE a (x);' });
    migrate(db, first);
    db.exec("INSERT INTO a VALUES (1)");
    const second = dir({ '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (y); INSERT INTO b SELECT x FROM a;', '0003_bad.sql': 'CREATE TABLE c (z); INSERT INTO nowhere VALUES (1);' });
    expect(() => migrate(db, second)).toThrow(/0003_bad.sql failed/);
    expect(ledger(db)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(tables(db)).toEqual(['a', 'b']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM b').get()).toEqual({ n: 1 });
    writeFileSync(join(second, '0003_bad.sql'), 'CREATE TABLE c (z);');
    expect(migrate(db, second).applied).toEqual(['0003_bad.sql']);
  });

  it('refuses an applied file that changed, a ledger this build does not ship, a reordered ledger and a missing directory', () => {
    const db = new DatabaseSync(':memory:');
    const files = { '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (y);' };
    migrate(db, dir(files));
    expect(() => migrate(db, dir({ ...files, '0002_b.sql': 'CREATE TABLE b (y, z);' }))).toThrow(/0002_b.sql changed/);
    expect(() => migrate(db, dir({ '0001_a.sql': files['0001_a.sql'] }))).toThrow(/applied 0002_b.sql at position 2/);
    expect(() => migrate(db, dir({ '0001_b.sql': files['0002_b.sql'], '0002_a.sql': files['0001_a.sql'] }))).toThrow(/applied 0001_a.sql at position 1/);
    expect(() => migrate(db, join(tmpdir(), 'hazelle-nowhere'))).toThrow(/cannot read/);
    expect(() => migrate(db, dir({}))).toThrow(/no .sql files/);
    expect(readFileSync(join(dir(files), '0001_a.sql'), 'utf8')).toBe(files['0001_a.sql']);
  });
});


it('migrates pulse without rewriting signed-in rows and keeps guest lists outside the accounts foreign key', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, dir(Object.fromEntries(readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0018').map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
  db.exec("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin', 'h', 1, 'inc', 't'); INSERT INTO pulse_seen VALUES (1, 'a')");
  expect(migrate(db, before('0027')).applied).toContain('0018_guest_pulse.sql');
  expect(db.prepare('SELECT pulse_guests FROM service').get()).toEqual({ pulse_guests: 1 });
  db.exec("INSERT INTO pulse_guest_seen VALUES (1, 'a')");
  expect(db.prepare('SELECT account FROM pulse_people_seen ORDER BY account').all()).toEqual([{ account: 'a' }]);
  db.exec("DELETE FROM accounts WHERE id = 'a'");
  expect(db.prepare('SELECT account FROM pulse_people_seen').all()).toEqual([{ account: 'a' }]);
  for (const table of ['pulse_guest_seen', 'pulse_guest_used', 'pulse_guest_replies']) expect(db.prepare(`PRAGMA foreign_key_list(${table})`).all()).toEqual([]);
  db.close();
});

it('adds guest authors and a persistent keyed address identity without changing existing board rows', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, dir(Object.fromEntries(readdirSync('migrations').filter((name) => name.endsWith('.sql') && name < '0020').map((name) => [name, readFileSync(join('migrations', name), 'utf8')]))));
  db.exec("INSERT INTO posts (title, text, category, visibility, created_at) VALUES ('이전 글', '본문', 'bug', 'public', 1); INSERT INTO comments (post_id, text, created_at) VALUES (1, '이전 댓글', 2)");
  expect(migrate(db, 'migrations').applied).toEqual(['0020_board_guests.sql', '0021_visits.sql', '0022_remote_pulse.sql', '0023_self_host_caps.sql', '0024_backup_folder.sql', '0025_pulse_week_below.sql', '0026_pulse_days.sql', '0027_accounts_only_pulse.sql', '0028_models_dev_tools.sql', '0029_guest_steps_and_cohorts.sql', '0030_auto_diagnoses.sql', '0031_post_pictures.sql']);
  const settings = db.prepare('SELECT board_guests, board_guest_key FROM service').get();
  expect(settings).toEqual({ board_guests: 1, board_guest_key: expect.stringMatching(/^[a-f0-9]{64}$/) });
  migrate(db, 'migrations');
  expect(db.prepare('SELECT board_guests, board_guest_key FROM service').get()).toEqual(settings);
  for (const table of ['posts', 'comments']) expect(db.prepare(`SELECT text, guest_secret_hash, guest_address_hash FROM ${table}`).get()).toMatchObject({ guest_secret_hash: null, guest_address_hash: null });
  for (const table of ['posts', 'comments']) expect((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(({ name }) => name)).not.toContain('guest_prefix');
  expect((db.prepare('PRAGMA table_info(board_guest_blocks)').all() as { name: string }[]).map(({ name }) => name)).toEqual(['secret_hash']);
  expect((db.prepare('PRAGMA table_info(board_guest_address_blocks)').all() as { name: string }[]).map(({ name }) => name)).toEqual(['address_hash', 'until']);
  expect(db.prepare('SELECT text FROM posts').get()).toEqual({ text: '본문' });
  expect(db.prepare('SELECT text FROM comments').get()).toEqual({ text: '이전 댓글' });
  db.close();
});

it('counts accounts only in 헤이젤 나우 and carries the last 7 days of guests into 손님 출신, without counting them again', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, before('0027'));
  db.exec(`INSERT INTO pulse_guest_used (day, role, key, type, account, name) VALUES (0, 'aux', '', 'direct', 'used', NULL);
    INSERT INTO pulse_guest_replies (hour, key, type, account, name, replies) VALUES (3600000, '', 'direct', 'replied', NULL, 1), (3600000, '', 'direct', 'remote:x', NULL, 1)`);
  expect(migrate(db, 'migrations').applied).toEqual(['0027_accounts_only_pulse.sql', '0028_models_dev_tools.sql', '0029_guest_steps_and_cohorts.sql', '0030_auto_diagnoses.sql', '0031_post_pictures.sql']);
  expect(db.prepare('SELECT guest FROM visit_guests ORDER BY guest').all()).toEqual([{ guest: 'replied' }, { guest: 'used' }]);
  expect(tables(db).filter((name) => name.startsWith('pulse_guest'))).toEqual([]);
  expect(Object.keys(db.prepare('SELECT * FROM service').get()!)).not.toContain('pulse_guests');
  db.exec(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('replied', 'jin', 'h', 1, 'inc', 't');
    INSERT INTO visit_guests (day, guest, step) VALUES (-32400000, 'new', 'replied')`);
  expect(db.prepare('SELECT day, guests, accounts, converted FROM visit_days').all()).toEqual([{ day: -32400000, guests: 2, accounts: 1, converted: 1 }]);
  db.close();
});

it('keeps stored guest ids as replies, counts each step in its own column, and starts counting signup weeks next Monday', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, before('0029'));
  db.exec("INSERT INTO visit_guests (day, guest) VALUES (0, 'replied')");
  expect(migrate(db, 'migrations').applied).toEqual(['0029_guest_steps_and_cohorts.sql', '0030_auto_diagnoses.sql', '0031_post_pictures.sql']);
  expect(db.prepare('SELECT guest, step FROM visit_guests').all()).toEqual([{ guest: 'replied', step: 'replied' }]);
  db.exec(`INSERT INTO visit_guests (day, guest, step) VALUES (0, 'opened', 'opened'), (0, 'connected', 'connected');
    INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('opened', 'jin', 'h', 1, 'inc', 't')`);
  expect(db.prepare('SELECT guests, opened, connected FROM visit_days WHERE day = 0').get()).toEqual({ guests: 1, opened: 1, connected: 1 });
  expect(db.prepare('SELECT converted FROM visit_days WHERE accounts = 1').get()).toEqual({ converted: 0 });
  const { from } = db.prepare('SELECT pulse_cohorts_from AS "from" FROM service').get() as { from: number };
  const kst = new Date(from + 9 * 3_600_000);
  expect([kst.getUTCDay(), kst.getUTCHours(), kst.getUTCMinutes()]).toEqual([1, 0, 0]);
  expect(from - Date.now()).toBeGreaterThan(0);
  expect(from - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
  db.close();
});

it("asks for the models.dev list again for its tool support, keeping the stored rows until it lands", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, before('0028'));
  db.exec(`INSERT INTO models_dev (list, model, price) VALUES ('openai', 'gpt-5', '{}'); UPDATE models_dev_fetch SET fetched_at = 5, tried_at = 5`);
  expect(migrate(db, 'migrations').applied).toEqual(['0028_models_dev_tools.sql', '0029_guest_steps_and_cohorts.sql', '0030_auto_diagnoses.sql', '0031_post_pictures.sql']);
  expect(db.prepare('SELECT model, tools FROM models_dev').all()).toEqual([{ model: 'gpt-5', tools: null }]);
  expect(db.prepare('SELECT fetched_at, tried_at FROM models_dev_fetch').get()).toEqual({ fetched_at: null, tried_at: null });
  db.close();
});
