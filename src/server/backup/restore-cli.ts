import { join } from 'node:path';
import { errorMessage } from '../../error-message';
import { chooseBucket } from '../files/choose';
import { restoreGeneration } from './restore';

// scripts/restore.sh runs this, bundled beside node.js: node dist/server/restore-cli.js <generation> <data directory>.
// The picture and snapshot store is the one the environment names, as for the server that will run on the directory.
const FLAGS = ['--snapshots-from-store', '--without-departures'];
const [generation, dataDir, ...flags] = process.argv.slice(2);
if (!generation || !dataDir || flags.some((flag) => !FLAGS.includes(flag))) {
  console.error('usage: restore <generation directory> <empty data directory> [--snapshots-from-store] [--without-departures]');
  process.exit(2);
}
// Two directories up from dist/server/restore-cli.js, as node.ts finds them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
try {
  const options = { fromStore: flags.includes('--snapshots-from-store'), withoutDepartures: flags.includes('--without-departures') };
  console.log(JSON.stringify(await restoreGeneration(generation, dataDir, migrationsDir, chooseBucket(process.env, dataDir), options)));
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
