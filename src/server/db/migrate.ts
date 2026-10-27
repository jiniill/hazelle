import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './transaction';

// Apply whole migrations in filename order, atomically with ledger entries. Require an unchanged ordered prefix:
// reject changed/missing files, gaps and newer DBs before serving; never downgrade.
export function migrate(db: DatabaseSync, directory: string): { applied: string[] } {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    throw new Error(`migrations: cannot read ${directory}`);
  }
  if (!names.length) throw new Error(`migrations: no .sql files in ${directory}`);
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const ledger = db.prepare('SELECT name, checksum FROM migrations ORDER BY rowid').all() as { name: string; checksum: string }[];
  const files = names.map((name) => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
  ledger.forEach((row, index) => {
    const file = files[index];
    if (!file || file.name !== row.name) throw new Error(`migrations: the database applied ${row.name} at position ${index + 1}, which this build does not ship there`);
    if (file.checksum !== row.checksum) throw new Error(`migrations: ${row.name} changed after it was applied`);
  });
  const applied: string[] = [];
  for (const file of files.slice(ledger.length)) {
    try {
      transaction(db, () => {
        db.exec(file.sql);
        db.prepare('INSERT INTO migrations (name, checksum, applied_at) VALUES (?, ?, ?)').run(file.name, file.checksum, Date.now());
      });
    } catch (error) {
      throw new Error(`migrations: ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    applied.push(file.name);
  }
  return { applied };
}
