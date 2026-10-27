import { isIPv6 } from 'node:net';

// The key every per-visitor limit counts by (frontend-worker.ts). An IPv6 subscriber holds a whole /64 and picks any
// address in it, so the key is the /64. Loopback and IPv4-mapped addresses stay whole: credentials.ts tells loopback
// by its text.
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
