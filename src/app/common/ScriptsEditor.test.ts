import { expect, it } from 'vitest';
import { PLAIN_LUA, type Pack } from '../../engine/import/types';
import { scriptList } from './ScriptsEditor';

it('names the list of the script open, and none for an id that names no script, such as one deleted', () => {
  const pack: Pick<Pack, 'regex' | 'triggers'> = { regex: [], triggers: [{ kind: 'lua', ...PLAIN_LUA, id: 'lua', name: '', code: '' }] };
  expect(scriptList(pack, 'lua')).toBe('triggers');
  expect(scriptList(pack, 'gone')).toBeUndefined();
  expect(scriptList(pack, null)).toBeUndefined();
});
