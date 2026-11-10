import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { migrate } from './db/migrate';
import { serviceDb, type Statement } from './db/service-db';
import { logged } from './operator';

it('stores each row byte for byte as the hand-written insert it replaced, and none while its target is gone', async () => {
  const raw = new DatabaseSync(':memory:');
  migrate(raw, 'migrations');
  raw.exec("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('a', 'jin \"진\"', 'h', 1, 'inc', 't')");
  const db = serviceDb(raw);
  const pairs: [Statement, Statement][] = [
    [
      logged(db, 5, 'set-service', { target: 'service', detail: { signupCap: 10, accountBytesCap: null, accountFileBytesCap: 20 } }),
      db.prepare("INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-service', 'service', ?)").bind(5, JSON.stringify({ signupCap: 10, accountBytesCap: null, accountFileBytesCap: 20 })),
    ],
    [
      logged(db, 5, 'send-notice', { target: 'everyone', detail: null }),
      db.prepare("INSERT INTO admin_log (at, action, target) VALUES (?, 'send-notice', 'everyone')").bind(5),
    ],
    [
      logged(db, 5, 'set-caps', { from: 'accounts WHERE id = ?2', detail: { username: 'username', bytesCap: 'json(?3)', fileBytesCap: 'json(?4)' } }, 'a', '"default"', '7'),
      db.prepare("INSERT INTO admin_log (at, action, target, detail) SELECT ?1, ?2, id, json_object('username', username, 'bytesCap', json(?4), 'fileBytesCap', json(?5)) FROM accounts WHERE id = ?3").bind(5, 'set-caps', 'a', '"default"', '7'),
    ],
    [
      logged(db, 5, 'restore-begun', { from: 'accounts WHERE id = ?5', detail: { username: 'username', operation: '?2', post: '?3', at: '?4', undoes: 'NULL' } }, 3, null, 9, 'a'),
      db.prepare("INSERT INTO admin_log (at, action, target, detail) SELECT ?1, 'restore-begun', id, json_object('username', username, 'operation', ?2, 'post', ?3, 'at', ?4, 'undoes', NULL) FROM accounts WHERE id = ?5").bind(5, 3, null, 9, 'a'),
    ],
    [
      logged(db, 5, 'lift', { from: 'accounts WHERE id = ?2', detail: { username: 'username' } }, 'gone'),
      db.prepare("INSERT INTO admin_log (at, action, target, detail) SELECT ?1, 'lift', id, json_object('username', username) FROM accounts WHERE id = ?2").bind(5, 'gone'),
    ],
  ];
  const rows = async (statement: Statement) => {
    await db.batch([db.prepare('DELETE FROM admin_log'), statement]);
    return (await db.prepare('SELECT at, action, target, detail FROM admin_log').all()).results;
  };
  for (const [written, old] of pairs) expect(await rows(written)).toEqual(await rows(old));
  expect(await rows(pairs[3]![0])).toEqual([{ at: 5, action: 'restore-begun', target: 'a', detail: '{"username":"jin \\"진\\"","operation":3.0,"post":null,"at":9.0,"undoes":null}' }]);
  expect(await rows(pairs[4]![0])).toEqual([]);
  raw.close();
});
