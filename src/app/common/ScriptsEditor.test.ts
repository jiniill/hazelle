import { expect, it, vi } from 'vitest';
import { PLAIN_LUA, type Pack } from '../../engine/import/types';
import { scriptsPage } from './ScriptsEditor';
import { SCRIPTS } from './words';

it('stands the script open alone in a drill, its back to the lists, and none for an id that names no script, such as one deleted', () => {
  const pack = { regex: [], triggers: [{ kind: 'lua', ...PLAIN_LUA, id: 'lua', name: '', code: '' }] } as unknown as Pack;
  const onOpen = vi.fn();
  const back = (drill: boolean, open: string | null) => scriptsPage({ owner: { kind: 'module', id: 'module' }, pack, drill, open, onOpen }).back;
  expect(back(true, 'lua')).toMatchObject({ backLabel: SCRIPTS.list });
  back(true, 'lua')!.onBack();
  expect(onOpen).toHaveBeenCalledWith(null);
  expect(back(false, 'lua')).toBeUndefined();
  expect(back(true, 'gone')).toBeUndefined();
  expect(back(true, null)).toBeUndefined();
});
