import { expect, it } from 'vitest';
import { visitorKey } from './visitor';

it('keys an IPv6 visitor by its /64 and leaves IPv4, mapped and loopback addresses whole', () => {
  expect(['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::9', '2001:db8:1:2::ffff:1.2.3.4', 'fe80::1%eth0', '2001:db8::'].map(visitorKey)).toEqual(['2001:db8:1:2::/64', '2001:db8:1:2::/64', '2001:db8:1:2::/64', 'fe80:0:0:0::/64', '2001:db8:0:0::/64']);
  expect(['203.0.113.9', '::ffff:127.0.0.1', '::1', 'unknown'].map(visitorKey)).toEqual(['203.0.113.9', '::ffff:127.0.0.1', '::1', 'unknown']);
});
