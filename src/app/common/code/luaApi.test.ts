import { expect, it } from 'vitest';
import { LuaFactory } from 'wasmoon';
import { host, OWNER, SNAPSHOT } from '../../../engine/lua/fixture';
import { Lua } from '../../../engine/lua/run';
import { LUA_API, LUA_INTERNAL, LUA_UNSUPPORTED } from './luaApi';
import { PLAIN_LUA } from '../../../engine/import/types';

const LIST = 'for name, value in pairs(_G) do if type(value) == "function" then names[#names + 1] = name end end';

it('names every function a script starts with, beyond Lua’s own', async () => {
  const bare = await new LuaFactory().createEngine();
  bare.doStringSync(`names = {} ${LIST}`);
  const own = new Set(bare.global.get('names') as string[]);
  bare.global.close();
  const machine = await Lua.create();
  const code = `local names = {} ${LIST} function onStart(id) for _, name in ipairs(names) do setChatVar(id, name, '') end end`;
  const outcome = await machine.run('api', [{ owner: OWNER, kind: 'lua', ...PLAIN_LUA, name: 'api', code }], SNAPSHOT, { kind: 'start' }, host(), 'event');
  const api = outcome.writes.map(([name]) => name).filter((name) => !own.has(name) && name !== 'onStart');
  machine.close();
  // require is Lua's own, replaced by the prelude: described, but not counted.
  expect(api.toSorted()).toEqual([...LUA_API.map(({ name }) => name), ...LUA_INTERNAL, ...LUA_UNSUPPORTED].filter((name) => !own.has(name)).toSorted());
});
