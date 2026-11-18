import { expect, it } from 'vitest';
import { BlockList } from 'node:net';
import { visitorKey, visitorFrom } from './visitor';

it('keys an IPv6 visitor by its /64 and leaves IPv4, mapped and loopback addresses whole', () => {
  expect(['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::9', '2001:db8:1:2::ffff:1.2.3.4', 'fe80::1%eth0', '2001:db8::'].map(visitorKey)).toEqual(['2001:db8:1:2::/64', '2001:db8:1:2::/64', '2001:db8:1:2::/64', 'fe80:0:0:0::/64', '2001:db8:0:0::/64']);
  expect(['203.0.113.9', '::ffff:127.0.0.1', '::1', 'unknown'].map(visitorKey)).toEqual(['203.0.113.9', '::ffff:127.0.0.1', '::1', 'unknown']);
});

it('takes a proxy\'s last word for the visitor, from a listed proxy or one on this machine, and no other peer\'s', () => {
  const trusted = new BlockList();
  trusted.addSubnet('172.30.0.0', 24, 'ipv4');
  const forwarded = '198.51.100.1, 203.0.113.9';
  expect(['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.30.0.2'].map((peer) => visitorFrom(peer, forwarded, trusted))).toEqual(Array(4).fill('203.0.113.9'));
  expect(visitorFrom('192.0.2.4', forwarded, trusted)).toBe('192.0.2.4');
  expect(visitorFrom('127.0.0.1', undefined, trusted)).toBe('127.0.0.1');
  expect(visitorFrom(undefined, forwarded, trusted)).toBe('unknown');
});
