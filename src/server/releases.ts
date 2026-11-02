import type { Upstream } from './relay';

// The newest release on GitHub, which a self-host's 앱 정보 offers when it is newer than the one running (node.ts asks
// hourly, a self-host only). Kept in memory: a restart asks again within the minute.
const LATEST = 'https://api.github.com/repos/jiniill/hazelle/releases/latest';
// A fetch is background work the shutdown drain waits for, so it is bounded.
const FETCH_MS = 30 * 1000;

const parts = (tag: string) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(Number) ?? null;

function isNewer(tag: string, than: string): boolean {
  const [next, now] = [parts(tag), parts(than)];
  if (!next || !now) return false;
  const differs = next.findIndex((part, at) => part !== now[at]);
  return differs !== -1 && next[differs]! > now[differs]!;
}

// running: this server's tag, null for a build without one, which is offered nothing.
export function releases(outbound: Upstream, running: string | null) {
  let latest: string | null = null;
  return {
    newer: () => (running !== null && latest !== null && isNewer(latest, running) ? latest : null),
    refresh: async () => {
      try {
        // api.github.com refuses a request without a User-Agent.
        const response = await outbound(new URL(LATEST), { method: 'GET', headers: new Headers({ 'user-agent': 'hazelle', accept: 'application/vnd.github+json' }), body: null, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
        const tag = response.ok ? ((await response.json()) as { tag_name?: unknown }).tag_name : null;
        if (typeof tag === 'string') latest = tag;
      } catch (error) {
        console.error('release check failed', String(error));
      }
    },
  };
}
