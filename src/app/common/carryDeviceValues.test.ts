import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS, type Settings } from '../../model/settings';
import { carryDeviceValues, withDeviceValues } from './carryDeviceValues';

describe('values carried from the device to the account', () => {
  it('fills what the account lacks, and never replaces what it holds', () => {
    const held = { tutorials: 'first second', welcome: '1', tour: 'v1', opened: 'v1', language: 'Japanese' };
    expect(withDeviceValues(EMPTY_SETTINGS, held)).toEqual({ ...EMPTY_SETTINGS, toolLanguage: 'Japanese', seen: { tutorials: ['first', 'second'], welcome: true, tour: 'v1', opened: 'v1' } });
    const later: Settings = { ...EMPTY_SETTINGS, toolLanguage: 'English', seen: { tour: 'v2', opened: 'v2' } };
    expect(withDeviceValues(later, held)).toEqual({ ...later, seen: { tutorials: ['first', 'second'], welcome: true, tour: 'v2', opened: 'v2' } });
  });

  it('clears the device keys only once the write landed, and writes nothing when there are none', async () => {
    const device = new Map([['risu-alpha:tour-seen', 'v1']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => device.get(key) ?? null, removeItem: (key: string) => device.delete(key) });
    const written = vi.fn(async () => ({ ok: false as const, error: 'offline' as const }));
    carryDeviceValues({ upsert: written } as never);
    await vi.waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    expect(device.get('risu-alpha:tour-seen')).toBe('v1');

    const landed = vi.fn(async () => ({ ok: true as const, data: null }));
    carryDeviceValues({ upsert: landed } as never);
    await vi.waitFor(() => expect(device.size).toBe(0));

    carryDeviceValues({ upsert: landed } as never);
    expect(landed).toHaveBeenCalledTimes(1);
  });
});
