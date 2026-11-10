import { describe, expect, it, vi } from 'vitest';
import { KeyedSnapshot, Snapshot } from './snapshot';

describe('Snapshot', () => {
  it('keeps its value and stays quiet when set to the same one', () => {
    const value = { n: 1 };
    const held = new Snapshot(value);
    const heard = vi.fn();
    held.subscribe(heard);
    held.set(value);
    expect(held.snapshot()).toBe(value);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('KeyedSnapshot', () => {
  it('keeps one map until a put, then holds a new one and tells once per put', () => {
    const held = new KeyedSnapshot<{ n: number }>();
    const heard = vi.fn();
    const stop = held.subscribe(heard);
    const empty = held.snapshot();
    expect(held.snapshot()).toBe(empty);

    held.put('a', { n: 1 });
    const one = held.snapshot();
    expect(one).not.toBe(empty);
    expect(empty.size).toBe(0);
    expect([...one]).toEqual([['a', { n: 1 }]]);
    expect(held.snapshot()).toBe(one);
    expect(heard).toHaveBeenCalledTimes(1);

    held.put('a', null);
    expect(held.snapshot()).not.toBe(one);
    expect(held.snapshot().size).toBe(0);
    expect(heard).toHaveBeenCalledTimes(2);

    held.put('gone', null);
    expect(heard).toHaveBeenCalledTimes(3);

    stop();
    held.put('b', { n: 2 });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
