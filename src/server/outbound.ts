import { promises as dns, type LookupAddress, type LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch } from 'undici';
import { destination } from '../connectors/destination';
import type { Upstream } from './relay';
import { checkTarget, isPublicAddress, PolicyRefusal } from './ssrf';

// All provider fetches use undici with validated, pinned DNS dispatch. Never substitute global fetch:
// it cannot use this undici instance's dispatcher.

export type Resolve = (hostname: string, options: LookupOptions) => Promise<LookupAddress[]>;

// Above stream-box's 14.5-minute call limit: undici's 5-minute defaults would cut a quiet provider before that limit.
const TIMEOUT_MS = 15 * 60 * 1000;
// Sockets per origin, not per process: undici's Agent gives each origin a pool of its own. Calls past it wait for a free
// socket rather than fail, so it stays far above one provider's share of the accounts' live calls (LIVE_CALLS each);
// the process-wide bound is those live calls.
const CONNECTIONS = 128;

// Validate every resolved address before dialing any; family fallback must not escape validation.
// Keep the original hostname for TLS, handling net's single/all lookup forms.
export function pinnedLookup(resolve: Resolve, allowed: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options).then(
      (addresses) => {
        if (addresses.some(({ address }) => !allowed(address))) return callback(new PolicyRefusal('not-public'), '');
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ''),
    );
  };
}

// HAZELLE_LOCAL_PROVIDERS: comma-separated host:port entries a self-hoster's own model servers listen on. Throws on a
// malformed entry, so the process refuses to start.
export function localProviders(list: string): ReadonlySet<string> {
  const entries = new Set<string>();
  for (const entry of list.split(',').map((each) => each.trim()).filter(Boolean)) {
    const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\]):(\d{1,5})$/i.exec(entry);
    const url = match && URL.canParse(`http://${entry}`) ? new URL(`http://${entry}`) : null;
    const [, host = '', port = ''] = match ?? [];
    // Kept as URL spells the host, which is how a destination is matched. A bracketed address takes that spelling; a
    // name URL would rewrite (2130706433, 0x7f.1) is a numeric spelling of another host, refused rather than guessed.
    if (!url || (!host.startsWith('[') && url.hostname !== host.toLowerCase()) || Number(port) < 1) throw new Error(`HAZELLE_LOCAL_PROVIDERS: "${entry}" is not host:port`);
    entries.add(`${url.hostname}:${Number(port)}`);
  }
  return entries;
}

function refusalIn(error: unknown): PolicyRefusal | null {
  for (let at = error; at instanceof Error; at = at.cause) if (at instanceof PolicyRefusal) return at;
  return null;
}

export function pinnedOutbound(local: ReadonlySet<string>, resolve: Resolve = (hostname, options) => dns.lookup(hostname, { ...options, all: true })): Upstream {
  const dispatcher = (allowed: (address: string) => boolean) =>
    new Agent({ connect: { lookup: pinnedLookup(resolve, allowed) }, connections: CONNECTIONS, bodyTimeout: TIMEOUT_MS, headersTimeout: TIMEOUT_MS });
  const pinned = dispatcher(isPublicAddress);
  // A listed destination may be plain http and answer a private address, and only it: the same host on another port
  // is not listed. It is still dialled only at what its lookup answered.
  const listed = dispatcher(() => true);
  return async (url, init) => {
    const isListed = local.has(destination(url));
    const refusal = isListed ? null : checkTarget(url);
    if (refusal) throw new PolicyRefusal(refusal);
    try {
      return (await fetch(url, { ...init, headers: [...init.headers], dispatcher: isListed ? listed : pinned })) as unknown as Response;
    } catch (error) {
      throw refusalIn(error) ?? error;
    }
  };
}
