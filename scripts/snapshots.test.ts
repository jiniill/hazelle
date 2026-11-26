import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };

function rig() {
  const root = mkdtempSync(join(tmpdir(), 'hazelle-copier-'));
  roots.push(root);
  const data = join(root, 'data');
  const remote = join(root, 'remote');
  const source = join(root, 'source');
  mkdirSync(join(data, 'backup', 'files'), { recursive: true });
  mkdirSync(remote);
  mkdirSync(source);
  const script = join(root, 'copier.sh');
  writeFileSync(script, readFileSync('deploy/rclone-backup.sh', 'utf8').replace('LOCAL=/data/backup', `LOCAL=${data}/backup`));
  writeFileSync(join(root, 'rclone'), `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), command = args.shift(), flags = {}, positional = [];
while (args.length) {
  const arg = args.shift();
  if (['--include', '--exclude', '--files-from-raw'].includes(arg)) (flags[arg] ??= []).push(args.shift());
  else if (arg.startsWith('-')) flags[arg] = true;
  else positional.push(arg);
}
const resolve = (name) => name.startsWith('backup:') ? path.join(process.env.REMOTE_ROOT, name.slice(7)) : name.startsWith('files:') ? path.join(process.env.SOURCE_ROOT, name.slice(6)) : name;
const a = resolve(positional[0]), b = positional[1] && resolve(positional[1]);
const walk = (dir, prefix = '') => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
// As rclone does: a listed name the source lacks is passed over, with no error.
const listed = command === 'delete' ? null : flags['--files-from-raw']?.flatMap(file => fs.readFileSync(file, 'utf8').split('\\n').filter(Boolean));
const named = (name) => !listed || listed.includes(name);
try {
  switch (command) {
    case 'copyto': copy(a, b); break;
    case 'copy':
      for (const name of walk(a)) if (!(flags['--exclude'] ?? []).includes(name) && named(name)) copy(path.join(a, name), path.join(b, name));
      break;
    case 'lsf': {
      let names = flags['--dirs-only'] ? fs.readdirSync(a, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name + '/') : walk(a);
      const include = flags['--include']?.[0];
      if (include === '/*/manifest.json') names = names.filter(n => /^[^/]+\\/manifest.json$/.test(n));
      if (include === '/files/*') names = names.filter(n => /^files\\/[^/]+$/.test(n));
      if (include === '/snapshots/**') names = names.filter(n => n.startsWith('snapshots/'));
      names = names.filter(named);
      if (names.length) console.log(names.join('\\n'));
      break;
    }
    case 'cat': process.stdout.write(fs.readFileSync(a)); break;
    case 'delete': for (const name of fs.readFileSync(flags['--files-from-raw'][0], 'utf8').trim().split('\\n')) fs.rmSync(path.join(a, name), { force: true }); break;
    case 'purge': fs.rmSync(a, { recursive: true, force: true }); break;
    default: throw new Error(command);
  }
} catch (error) { console.error(String(error)); process.exit(1); }
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, REMOTE_ROOT: remote, SOURCE_ROOT: source, HAZELLE_BACKUP_REMOTE: 'backup:archive' };
  const run = () => spawnSync('sh', [script, 'once'], { env, encoding: 'utf8' });
  return { root, data, remote: join(remote, 'archive'), source: join(source, 'pictures'), env, run };
}

it('copies v4 archives before marking, fetches them from the backup alone, and prunes only when neither a manifest nor the source names them', () => {
  const t = rig();
  const id = `${Date.now()}-12345678`;
  const key = `${'a'.repeat(32)}/123-abcdef012345.sqlite.gz`;
  const other = `${'a'.repeat(32)}/124-abcdef012345.sqlite.gz`;
  const orphan = `${'a'.repeat(32)}/125-abcdef012345.sqlite.gz`;
  const manifest = { version: 4, id, capturedAt: Date.now(), service: { path: 'service.sqlite.gz' }, bucket: 'r2', snapshotStore: { kind: 'r2', bucket: 'pictures' }, accounts: [], snapshots: [{ path: `snapshots/${key}` }], operations: [], pictures: ['b'.repeat(64)], migrations: [] };
  const generation = join(t.data, 'backup', id);
  put(join(generation, 'manifest.json'), JSON.stringify(manifest));
  put(join(generation, 'service.sqlite.gz'), 'service');
  put(join(t.data, 'backup', 'departures.json'), '[]');
  // A missing named source must not leave a complete remote generation or a local marker.
  expect(t.run().status).toBe(1);
  expect(existsSync(join(generation, 'copied'))).toBe(false);
  expect(existsSync(join(t.remote, id, 'manifest.json'))).toBe(false);
  put(join(t.source, 'snapshots', key), 'archive');
  const copied = t.run();
  expect({ status: copied.status, stderr: copied.stderr }).toEqual({ status: 0, stderr: '' });
  expect(readFileSync(join(t.remote, 'snapshots', 'pictures', key), 'utf8')).toBe('archive');
  expect(readFileSync(join(t.remote, id, 'copied'), 'utf8')).toBe(readFileSync(join(generation, 'copied'), 'utf8'));
  rmSync(join(t.source, 'snapshots', key));
  put(join(t.source, 'snapshots', other), 'source holds it');
  put(join(t.remote, 'snapshots', 'pictures', other), 'source holds it');
  put(join(t.remote, 'snapshots', 'pictures', orphan), 'unreferenced');
  expect(t.run().status).toBe(0);
  expect(existsSync(join(t.remote, 'snapshots', 'pictures', key))).toBe(true);
  expect(existsSync(join(t.remote, 'snapshots', 'pictures', other))).toBe(true);
  expect(existsSync(join(t.remote, 'snapshots', 'pictures', orphan))).toBe(false);
  const download = join(t.root, 'download');
  const fetched = spawnSync('sh', ['scripts/restore.sh', 'fetch', 'backup:archive', id, download], { env: t.env, encoding: 'utf8' });
  expect({ status: fetched.status, stderr: fetched.stderr }).toEqual({ status: 0, stderr: '' });
  expect(readFileSync(join(download, id, 'snapshots', key), 'utf8')).toBe('archive');
  expect(readFileSync(join(download, 'departures.json'), 'utf8')).toBe('[]');
});

it('moves local archives only after the stopped-app copy and every catalogued size have verified', () => {
  const root = mkdtempSync(join(tmpdir(), 'hazelle-move-'));
  roots.push(root);
  const data = join(root, 'data');
  const key = `${'a'.repeat(32)}/123-abcdef012345.sqlite.gz`;
  put(join(data, 'snapshots', key), 'archive');
  const script = join(root, 'move.sh');
  writeFileSync(script, readFileSync('scripts/move-pictures-to-r2.sh', 'utf8').replaceAll('/data', data));
  writeFileSync(join(root, 'hazelle-compose'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'ps') process.exit(0);
if (args.includes('node')) console.log(process.env.STORED);
else if (args.includes('lsf')) console.log(process.env.LISTED);
else if (!args.includes('copy')) process.exit(1);
`, { mode: 0o755 });
  const calls = join(root, 'calls');
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: calls, STORED: `7;${key}`, LISTED: `6;${key}` };
  const refused = spawnSync('sh', [script, 'move-snapshots', 'pictures'], { env, encoding: 'utf8' });
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('local archives kept');
  expect(existsSync(join(data, 'snapshots', key))).toBe(true);
  const moved = spawnSync('sh', [script, 'move-snapshots', 'pictures'], { env: { ...env, LISTED: env.STORED }, encoding: 'utf8' });
  expect({ status: moved.status, stderr: moved.stderr }).toEqual({ status: 0, stderr: '' });
  expect(existsSync(join(data, 'snapshots'))).toBe(false);
  const first = readFileSync(calls, 'utf8').trim().split('\n').slice(0, 4).map((line) => JSON.parse(line) as string[]);
  expect(first[0]).toEqual(['ps', '-q', 'app']);
  expect(first[1]).toContain('copy');
  expect(first[2]).toContain('node');
  expect(first[3]).toContain('lsf');
});
