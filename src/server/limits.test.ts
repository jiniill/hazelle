import { describe, expect, it } from 'vitest';
import { dailyDistinct, proofBackoff, relayBudget, tokenBucket, uploadBudget } from './limits';

const setup = (perMinute: number) => {
  let now = 0;
  const limiter = tokenBucket(perMinute, 60_000, () => now);
  const burst = (key: string) => {
    let passed = 0;
    while (limiter.limit(key).success) passed++;
    return passed;
  };
  return { limiter, burst, advance: (ms: number) => void (now += ms) };
};

describe('the token bucket', () => {
  it('passes a burst of perMinute and refuses the next', () => {
    const { limiter } = setup(20);
    for (let i = 0; i < 20; i++) expect(limiter.limit('a').success).toBe(true);
    expect(limiter.limit('a').success).toBe(false);
  });

  it('refills in proportion to the time passed, up to a full burst', () => {
    const { burst, advance } = setup(240);
    expect(burst('a')).toBe(240);
    advance(15_000);
    expect(burst('a')).toBe(60);
    advance(60_000);
    expect(burst('a')).toBe(240);
    advance(10 * 60_000);
    expect(burst('a')).toBe(240);
  });

  it('keeps keys independent', () => {
    const { burst } = setup(20);
    expect(burst('a')).toBe(20);
    expect(burst('b')).toBe(20);
  });

  it('evicts an idle key, which starts full, and keeps a recent one drained', () => {
    const { limiter, burst, advance } = setup(20);
    burst('idle');
    advance(10 * 60_000);
    burst('recent');
    advance(1_000);
    limiter.evict();
    expect(limiter.limit('recent').success).toBe(false);
    expect(burst('idle')).toBe(20);
  });
});

describe('credential limits', () => {
  it('reports the next token time and bounds the request cache by least recent use', () => {
    let now = 0;
    const limiter = tokenBucket(30, 60_000, () => now, 2);
    for (let i = 0; i < 30; i++) limiter.limit('old');
    expect(limiter.limit('old')).toEqual({ success: false, retryAfter: 2 });
    now = 1500;
    expect(limiter.limit('old').retryAfter).toBe(1);
    now = 2000;
    expect(limiter.limit('old').success).toBe(true);
    limiter.limit('new');
    limiter.limit('newest');
    expect(limiter.limit('old').success).toBe(true);
  });

  it('doubles a pair’s backoff to an hour, preserves active locks on eviction, and resets the pair on success', () => {
    let now = 0;
    const limiter = proofBackoff(() => now);
    for (let i = 0; i < 5; i++) expect(limiter.check('visitor', 'jin', false)).toBe(0);
    for (const minutes of [1, 2, 4, 8, 16, 32, 60, 60]) {
      expect(limiter.check('visitor', 'jin', true)).toBe(minutes * 60);
      now += minutes * 60_000 - 1;
      limiter.evict();
      expect(limiter.check('visitor', 'jin', false)).toBe(1);
      now++;
      expect(limiter.check('visitor', 'jin', false)).toBe(0);
    }
    now += 60 * 60_000;
    expect(limiter.check('visitor', 'jin', true)).toBe(0);
    for (let i = 0; i < 4; i++) expect(limiter.check('visitor', 'jin', false)).toBe(0);
    expect(limiter.check('visitor', 'jin', true)).toBe(0);
  });

  it('bounds visitor state and expires idle failures after a day', () => {
    let now = 0;
    const limiter = proofBackoff(() => now, 2);
    for (let i = 0; i < 5; i++) limiter.check('old', 'jin', false);
    limiter.check('recent', 'jin', false);
    limiter.check('newest', 'jin', false);
    expect(limiter.check('old', 'jin', true)).toBe(0);
    for (let i = 0; i < 4; i++) limiter.check('recent', 'jin', false);
    expect(limiter.check('recent', 'jin', true)).toBe(60);
    now += 24 * 60 * 60_000;
    limiter.evict();
    for (let i = 0; i < 4; i++) expect(limiter.check('recent', 'jin', false)).toBe(0);
    expect(limiter.check('recent', 'jin', true)).toBe(0);
  });
});

describe('uploadBudget', () => {
  it('holds bodies by their bytes, lets waiters in by arrival order as bytes free, and answers false once the wait runs out', async () => {
    const budget = uploadBudget(10, 20);
    expect(await Promise.all([budget.take(6), budget.take(4)])).toEqual([true, true]);
    const big = budget.take(5);
    const small = budget.take(1);
    budget.give(4);
    let entered = false;
    void small.then(() => (entered = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(entered).toBe(false);
    budget.give(6);
    expect(await Promise.all([big, small])).toEqual([true, true]);
    expect(await budget.take(5)).toBe(false);
    budget.give(5);
    expect(await budget.take(5)).toBe(true);
  });

  it('lets the body behind a head that gave up in, without waiting for a give', async () => {
    const budget = uploadBudget(10, 20);
    expect(await budget.take(8)).toBe(true);
    const big = budget.take(5);
    const small = budget.take(2);
    expect(await big).toBe(false);
    expect(await Promise.race([small, new Promise((resolve) => setTimeout(() => resolve('late'), 10))])).toBe(true);
  });
});

describe('relayBudget', () => {
  it('shares a byte budget across calls, isolates accounts and renews existing handles at UTC midnight', () => {
    let now = 86_399_999;
    const budget = relayBudget(10, 2, () => now);
    const first = budget.account('a');
    expect(first.take(6)).toBe(true);
    expect(budget.account('a').take(5)).toBe(false);
    expect(first.take(0)).toBe(false);
    expect(budget.account('b').take(10)).toBe(true);
    now++;
    expect(first.take(10)).toBe(true);
    expect(first.take(1)).toBe(false);
  });

  it('counts canonical hostnames, not paths or ports, and forgets the host set on the next day', () => {
    let now = 0;
    const budget = relayBudget(100, 1, () => now);
    const a = budget.account('a');
    expect(a.visit(new URL('https://EXAMPLE.com/a'))).toBe(true);
    expect(a.visit(new URL('https://example.com.:8443/b'))).toBe(true);
    expect(a.visit(new URL('https://other.test/'))).toBe(false);
    expect(budget.account('b').visit(new URL('https://other.test/'))).toBe(true);
    now = 86_400_000;
    expect(a.visit(new URL('https://other.test/'))).toBe(true);
    expect(a.visit(new URL('https://example.com/'))).toBe(false);
  });
});

describe('the daily distinct set', () => {
  it('takes max members a key, knows them again, and forgets them at KST midnight', () => {
    // 23:00 KST.
    let now = Date.parse('2026-10-27T14:00:00Z');
    const distinct = dailyDistinct(2, () => now);
    expect(['x', 'y', 'x', 'z'].map((member) => distinct.add('a', member))).toEqual(['new', 'new', 'known', 'full']);
    expect(distinct.add('b', 'z')).toBe('new');
    now += 60 * 60_000;
    expect(distinct.add('a', 'z')).toBe('new');
  });
});
