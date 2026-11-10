import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS, type Settings } from '../../model/settings';
import { carryDeviceValues, withDeviceValues } from './device-values';

describe('values carried from the device to the account', () => {
  it('fills what the account lacks, and never replaces what it holds', () => {
    const held = { tutorials: 'first second', welcome: '1', tour: 'v1', opened: 'v1', language: 'Japanese' };
    expect(withDeviceValues(EMPTY_SETTINGS, held)).toEqual({ ...EMPTY_SETTINGS, toolLanguage: 'Japanese', seen: { tutorials: ['first', 'second'], welcome: true, tour: 'v1', opened: 'v1' } });
    const later: Settings = { ...EMPTY_SETTINGS, toolLanguage: 'English', seen: { tour: 'v2', opened: 'v2' } };
    expect(withDeviceValues(later, held)).toEqual({ ...later, seen: { tutorials: ['first', 'second'], welcome: true, tour: 'v2', opened: 'v2' } });
  });

  it('clears the device keys only once the write landed, and writes nothing when there are none', async () => {
    const kept = new Map([['risu-alpha:tour-seen', 'v1']]);
    const device = { read: (key: string) => kept.get(key) ?? null, forget: (key: string) => void kept.delete(key) };
    const written = vi.fn(async () => ({ ok: false as const, error: 'offline' as const }));
    carryDeviceValues({ upsert: written } as never, device);
    await vi.waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    expect(kept.get('risu-alpha:tour-seen')).toBe('v1');

    const landed = vi.fn(async () => ({ ok: true as const, data: null }));
    carryDeviceValues({ upsert: landed } as never, device);
    await vi.waitFor(() => expect(kept.size).toBe(0));

    carryDeviceValues({ upsert: landed } as never, device);
    expect(landed).toHaveBeenCalledTimes(1);
  });
});
