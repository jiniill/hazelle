import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Sample = { at: number; cpuPercent: number; memBytes: number; rssBytes: number | null };

export type ContainerOptions = { image: string; name: string; dataDir: string; port: number; provider: string; snapshotHour: number; cpus: number; memory: string; env: string[] };

export async function docker(...args: string[]): Promise<string> {
  return (await run('docker', args, { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 })).stdout;
}

export async function startContainer(options: ContainerOptions) {
  await docker(
    'run', '-d', '--name', options.name,
    '--cpus', String(options.cpus), '--memory', options.memory,
    '-p', `127.0.0.1:${options.port}:8080`,
    '-v', `${options.dataDir}:/data`,
    '--add-host', 'host.docker.internal:host-gateway',
    // The hourly models.dev refresh would reach the internet; pointed at loopback, the outbound policy refuses it.
    '--add-host', 'models.dev:127.0.0.1',
    '-e', `HAZELLE_SNAPSHOT_HOUR=${options.snapshotHour}`,
    '-e', `HAZELLE_LOCAL_PROVIDERS=${options.provider}`,
    // Trust Docker's bridge so the harness can identify loopback and avoid signup/login throttling.
    '-e', 'HAZELLE_TRUSTED_PROXIES=0.0.0.0/0,::/0',
    ...options.env.flatMap((pair) => ['-e', pair]),
    options.image,
  );
}

export async function stopContainer(name: string) {
  await docker('stop', '-t', '120', name).catch(() => '');
  await docker('rm', '-f', name).catch(() => '');
}

// Read-only, through the container's own node:sqlite: the service file is in WAL mode, so a reader beside the
// server sees committed rows without taking its write lock.
export async function query<T>(name: string, sql: string): Promise<T[]> {
  const script = `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/service.sqlite', { readOnly: true }); process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()));`;
  return JSON.parse(await docker('exec', '-e', 'NODE_OPTIONS=--max-old-space-size=4096', name, 'node', '-e', script)) as T[];
}

export async function logs(name: string): Promise<string> {
  const { stdout, stderr } = await run('docker', ['logs', name], { maxBuffer: 256 * 1024 * 1024 });
  return stdout + stderr;
}

// docker stats for CPU and the cgroup's memory (which counts active page cache), and the node process's own RSS from
// /proc, sampled until stopped.
export function sampler(name: string, intervalMs = 1000) {
  const samples: Sample[] = [];
  let latestRss: number | null = null;
  const stats = spawn('docker', ['stats', '--format', '{{json .}}', name], { stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = '';
  stats.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    for (const match of pending.matchAll(/\{[^{}]*\}/g)) {
      const row = JSON.parse(match[0]) as { CPUPerc: string; MemUsage: string };
      samples.push({ at: Date.now(), cpuPercent: parseFloat(row.CPUPerc), memBytes: bytesOf(row.MemUsage.split('/')[0]!.trim()), rssBytes: latestRss });
    }
    pending = pending.slice(pending.lastIndexOf('}') + 1);
  });
  let stopped = false;
  const rss = (async () => {
    while (!stopped) {
      const status = await docker('exec', name, 'cat', '/proc/1/status').catch(() => '');
      const kb = /VmRSS:\s+(\d+)/.exec(status)?.[1];
      if (kb) latestRss = Number(kb) * 1024;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();
  return {
    samples,
    stop: async () => {
      stopped = true;
      stats.kill('SIGKILL');
      await rss;
      return samples;
    },
  };
}

function bytesOf(text: string): number {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/.exec(text);
  if (!match) return NaN;
  const scale: Record<string, number> = { B: 1, KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30, TiB: 2 ** 40, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 };
  return Number(match[1]) * (scale[match[2]!] ?? NaN);
}

export async function diskBytes(dir: string): Promise<number> {
  return Number((await run('du', ['-sb', dir], { maxBuffer: 1024 * 1024 })).stdout.split('\t')[0]);
}
