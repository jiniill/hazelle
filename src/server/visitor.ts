import { isIPv6, type BlockList } from 'node:net';

// The key every per-visitor limit counts by (frontend-worker.ts). An IPv6 subscriber holds a whole /64 and picks any
// address in it, so the key is the /64. Loopback and IPv4-mapped addresses stay whole: LOOPBACK tells them by their text.
export function visitorKey(address: string): string {
  if (!isIPv6(address) || address === '::1' || /^::ffff:/i.test(address)) return address;
  const [head = '', tail] = address.split('%')[0]!.split('::');
  const before = head ? head.split(':') : [];
  const after = tail ? tail.split(':') : [];
  // A dotted IPv4 tail fills two groups.
  const width = (groups: string[]) => groups.reduce((sum, group) => sum + (group.includes('.') ? 2 : 1), 0);
  const groups = [...before, ...Array<string>(tail === undefined ? 0 : 8 - width(before) - width(after)).fill('0'), ...after];
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

// This machine itself. As a visitor it is past the attempt limits (credentials.ts); as a peer it is a proxy.
export const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.)/;

// Who sent a request: its peer, or the last X-Forwarded-For entry when the peer is a proxy, which appended it. A proxy
// is a listed one (HAZELLE_TRUSTED_PROXIES) or any on this machine: a tunnel beside the app (cloudflared, tailscale
// serve) dials from loopback, and counted as the visitor it would put everyone it carries past the attempt limits.
export function visitorFrom(peer: string | undefined, forwarded: string | string[] | undefined, trusted: BlockList): string {
  const proxied = peer !== undefined && (LOOPBACK.test(peer) || trusted.check(peer, isIPv6(peer) ? 'ipv6' : 'ipv4'));
  return visitorKey((proxied && (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').at(-1)?.trim()) || peer || 'unknown');
}
