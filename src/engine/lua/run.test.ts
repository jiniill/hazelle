import { describe, expect, it, vi } from 'vitest';
import { LuaFactory } from 'wasmoon';
import { blockConditions, blockEffects } from '../import/blocks';
import type { Blocks } from './blocks';
import { Lua, type Script } from './run';
import type { Event, Host } from '../script-api';
import { host, OWNER, SNAPSHOT } from './fixture';
import type { Snapshot } from './state';

const lua = await Lua.create({ sliceMs: 300 });
let owner = 0;
const run = (code: string, event: Event, over: Partial<Host> = {}, snapshot = SNAPSHOT) => lua.run(String(owner++), [{ owner: OWNER, kind: 'lua', name: 'main', code }], snapshot, event, host(over), 'event');
const blocks = (on: string, effects: unknown[], conditions: unknown[] = []): Blocks => ({ owner: OWNER, kind: 'blocks', name: 'blocks', on, conditions: blockConditions(conditions), effects: blockEffects(effects) });

describe('Lua runs', () => {
  it('ends a cancelled yielding loop without another host call', async () => {
    const controller = new AbortController();
    const tokens = vi.fn<Host['tokens']>(async () => {
      if (tokens.mock.calls.length === 3) controller.abort(new Error('Lua run cancelled'));
      return 1;
    });
    const outcome = await lua.run(String(owner++), [{ owner: OWNER, kind: 'lua', name: 'loop', code: 'onStart = async(function(id) while true do getTokens(id, "x"):await() end end)' }], SNAPSHOT, { kind: 'start' }, host({ tokens }), 'preview', controller.signal);
    expect(outcome.errors).toEqual([expect.objectContaining({ script: 'loop', message: expect.stringContaining('Lua run cancelled') })]);
    expect(tokens).toHaveBeenCalledTimes(3);
  });

  it('pins complete nine-script worksets across stretches and lanes, then evicts idle worksets as a whole', async () => {
    const machine = await Lua.create();
    const starts = vi.spyOn(LuaFactory.prototype, 'createEngine');
    const scripts: Script[] = Array.from({ length: 9 }, (_, index) => ({ owner: OWNER, kind: 'lua', name: String(index), code: `
      local counter = 0
      function onStart(id) counter = counter + 1; setChatVar(id, 's${index}', counter) end
      listenEdit('editDisplay', function(id, value) counter = counter + 1; return value .. ':' .. counter end)
    ` }));
    const event = () => machine.run('active', scripts, SNAPSHOT, { kind: 'start' }, host(), 'event');
    let revision = 0;
    const display = async () => {
      await machine.installDisplay('active', ++revision, scripts, SNAPSHOT, [{ index: 0, text: '', variables: [] }]);
      return machine.display('active', revision, 1);
    };
    try {
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('1'));
      expect((await display()).texts).toEqual([':1'.repeat(9)]);
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('2'));
      expect((await display()).texts).toEqual([':2'.repeat(9)]);
      expect(starts).toHaveBeenCalledTimes(18);
      await machine.run('next', scripts, SNAPSHOT, { kind: 'start' }, host(), 'event');
      expect((await display()).texts).toEqual([':3'.repeat(9)]);
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('1'));
      expect(starts).toHaveBeenCalledTimes(36);
    } finally {
      machine.close();
      starts.mockRestore();
    }
  });

  it('closes a retired run’s later engines after a host wait without closing a new run of the same owner', async () => {
    const machine = await Lua.create();
    const starts = vi.spyOn(LuaFactory.prototype, 'createEngine');
    let reached!: () => void;
    let answer!: (value: string | null) => void;
    const asked = new Promise<void>((resolve) => { reached = resolve; });
    const scripts: Script[] = [
      { owner: OWNER, kind: 'lua', name: 'wait', code: "onStart = async(function(id) alertInput(id, 'wait'):await() end)" },
      { owner: OWNER, kind: 'lua', name: 'later', code: "function onStart(id) setChatVar(id, 'later', 'done') end" },
    ];
    try {
      const old = machine.run('owner', scripts, SNAPSHOT, { kind: 'start' }, host({ ask: () => new Promise((resolve) => { answer = resolve; reached(); }) }), 'event');
      await asked;
      machine.close();
      await machine.run('owner', [scripts[1]!], SNAPSHOT, { kind: 'start' }, host(), 'event');
      answer(null);
      expect(await old).toMatchObject({ errors: [], writes: [['later', 'done']] });
      const engines = await Promise.all(starts.mock.results.map(({ value }) => value));
      await vi.waitFor(() => expect(engines.map((engine) => engine.global.isClosed())).toEqual([true, false, true]));
      machine.close();
      await vi.waitFor(() => expect(engines.every((engine) => engine.global.isClosed())).toBe(true));
    } finally {
      machine.close();
      starts.mockRestore();
    }
  });

  it('reads and writes variables and state, reporting only what changed', async () => {
    const outcome = await run(
      `function onOutput(id)
        setChatVar(id, 'hp', tonumber(getChatVar(id, 'hp')) - 3)
        setChatVar(id, 'unset', getChatVar(id, 'missing'))
        setState(id, 'bag', { 'key', 'map' })
        setChatVar(id, 'seen', getState(id, 'bag')[2] .. getGlobalVar(id, 'toggle_hard'))
      end`,
      { kind: 'output' },
    );
    expect(outcome.errors).toEqual([]);
    expect(outcome.handled).toBe(true);
    expect(new Map(outcome.writes)).toEqual(new Map([['hp', '7'], ['unset', 'null'], ['__bag', '["key","map"]'], ['seen', 'map1']]));
  });

  it("unsets on a nil write, which then reads as the card's default or null", async () => {
    const card = { variables: [['mood', 'calm']] } as unknown as Snapshot['scope']['card'];
    const outcome = await run(
      `function onOutput(id)
        setChatVar(id, 'mood', 'angry')
        setChatVar(id, 'mood', nil)
        setState(id, 'bag', { 'key' })
        setChatVar(id, '__bag', nil)
        setChatVar(id, 'seen', getChatVar(id, 'mood') .. '/' .. tostring(getState(id, 'bag')))
      end`,
      { kind: 'output' },
      {},
      { ...SNAPSHOT, scope: { ...SNAPSHOT.scope, card } },
    );
    expect(outcome.errors).toEqual([]);
    expect(new Map(outcome.writes)).toEqual(new Map([['mood', 'calm'], ['__bag', 'null'], ['seen', 'calm/nil']]));
  });

  it('turns chat writes into edits, removals and additions by the snapshot index', async () => {
    const outcome = await run(
      `function onOutput(id)
        local last = getChat(id, -1)
        setChat(id, -1, last.data .. '!' .. getChatLength(id) .. getFullChat(id)[1].role)
        addChat(id, 'user', 'more')
        removeChat(id, 0)
      end`,
      { kind: 'output' },
    );
    expect(outcome).toMatchObject({ errors: [], edits: [{ index: 1, text: 'hi there!2user' }], removed: [0], added: [{ role: 'user', text: 'more' }] });
  });

  it('awaits the host in an async handler and stops the turn on false or stopChat', async () => {
    const asked = await run(
      `onStart = async(function(id)
        local name = alertInput(id, 'name?'):await()
        local answer = LLM(id, { { role = 'user', content = name } })
        alertNormal(id, answer.result .. getTokens(id, 'four'):await())
        return false
      end)`,
      { kind: 'start' },
      { ask: async (question) => (question.kind === 'input' ? 'typed' : null), model: async (role, messages) => ({ success: true, result: `${role}:${messages[0]!.content}` }) },
    );
    expect(asked).toMatchObject({ errors: [], stop: true });
    expect((await run(`function onInput(id) stopChat(id) end`, { kind: 'input' })).stop).toBe(true);
  });

  it('refuses an unknown axLLM mode without a call, and awaits simpleLLM as a promise', async () => {
    const model = vi.fn(async (role: 'main' | 'aux') => ({ success: true as const, result: role }));
    const outcome = await run(
      `onStart = async(function(id)
        local bad = axLLM(id, {}, false, { mode = 'vision' })
        local good = axLLM(id, {}, false, { mode = 'memory', streaming = true })
        setChatVar(id, 'ax', tostring(bad.success) .. '|' .. bad.result .. '|' .. good.result)
        setChatVar(id, 'simple', simpleLLM(id, 'hi'):await().result)
      end)`,
      { kind: 'start' },
      { model },
    );
    expect(outcome.errors).toEqual([]);
    expect(new Map(outcome.writes)).toEqual(new Map([['ax', 'false|Error: Invalid axLLM mode: vision|aux'], ['simple', 'main']]));
    expect(model.mock.calls.map(([role]) => role)).toEqual(['aux', 'main']);
  });

  it("reads the card's background, and sees its own save only when the host keeps it", async () => {
    const code = `onStart = async(function(id)
      setChatVar(id, 'before', getBackgroundEmbedding(id))
      setChatVar(id, 'saved', tostring(setBackgroundEmbedding(id, '<style>.b{}</style><!--rules-->')))
      setChatVar(id, 'after', getBackgroundEmbedding(id))
    end)`;
    const card = { ...SNAPSHOT, scope: { ...SNAPSHOT.scope, card: { background: '<style>.a{}</style>' } as Snapshot['scope']['card'] } };
    const kept: [string, unknown][] = [];
    const saved = await run(code, { kind: 'start' }, { background: async (html, from) => (kept.push([html, from]), true) }, card);
    expect(saved.writes).toEqual([['before', '<style>.a{}</style>'], ['saved', 'true'], ['after', '<style>.b{}</style><!--rules-->']]);
    expect(kept).toEqual([['<style>.b{}</style><!--rules-->', OWNER]]);
    expect((await run(code, { kind: 'start' }, {}, card)).writes).toEqual([['before', '<style>.a{}</style>'], ['saved', 'false'], ['after', '<style>.a{}</style>']]);
  });

  it('starts a background save from a function that is not async, which answers nil', async () => {
    const kept: string[] = [];
    const outcome = await run(`function onStart(id) setChatVar(id, 'saved', tostring(setBackgroundEmbedding(id, '<style>.b{}</style>'))) end`, { kind: 'start' }, { background: async (html) => (kept.push(html), true) });
    expect(outcome.errors).toEqual([]);
    expect(outcome.writes).toEqual([['saved', 'nil']]);
    expect(kept).toEqual(['<style>.b{}</style>']);
  });

  it("evaluates the persona description's CBS over the run's variables", async () => {
    const persona = { ...SNAPSHOT, persona: { name: 'Jin', description: '{{user}} at hp {{getvar::hp}}' } };
    const outcome = await run(`function onStart(id) setChatVar(id, 'hp', 4) setChatVar(id, 'persona', getPersonaDescription(id)) end`, { kind: 'start' }, {}, persona);
    expect(new Map(outcome.writes).get('persona')).toBe('Jin at hp 4');
  });

  it('chains edit listeners and keeps the value when one returns nothing', async () => {
    const code = `listenEdit('editOutput', function(id, value, meta) return value .. meta.index end)
      listenEdit('editOutput', function(id, value) end)`;
    expect((await run(code, { kind: 'edit', stage: 'editOutput', value: 'text', meta: { index: 4 } })).value).toBe('text4');
    const request = [{ role: 'user', content: 'a' }];
    expect((await run(`listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'b' } return value end)`, { kind: 'edit', stage: 'editRequest', value: request, meta: {} })).value).toEqual([...request, { role: 'system', content: 'b' }]);
  });

  it("calls a button's function only when the script defined it", async () => {
    const code = `function open(id) setChatVar(id, 'door', 'open') end
      function onButtonClick(id, data) setChatVar(id, 'pressed', data) end`;
    expect((await run(code, { kind: 'call', name: 'open', id: '' })).writes).toEqual([['door', 'open']]);
    expect((await run(code, { kind: 'button', data: 'b1' })).writes).toEqual([['pressed', 'b1']]);
    expect(await run(code, { kind: 'call', name: 'removeChat', id: '' })).toMatchObject({ handled: false, removed: [] });
    expect((await run(code, { kind: 'call', name: 'nothing', id: '' })).handled).toBe(false);
  });

  it('reports CBS its cbs() call ran away with as a runaway, and leaves one the script catches to it', async () => {
    const doubling = "'{{settempvar::x::abcdefghijklmnop}}' .. string.rep('{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}', 22)";
    expect((await run(`function onStart(id) cbs(${doubling}) end`, { kind: 'start' })).errors).toEqual([{ from: OWNER, script: 'main', runaway: true }]);
    expect((await run(`function onStart(id) pcall(cbs, ${doubling}) end`, { kind: 'start' })).errors).toEqual([]);
  });

  it('reports an error with its line, a function this app lacks, and a script that never ends', async () => {
    const failed = await run(`function onStart(id)\n  local none = nil\n  return none.field\nend`, { kind: 'start' });
    expect(failed.errors[0]).toMatchObject({ message: expect.stringContaining('main:3:') });
    expect((await run(`function onStart(id) generateImage(id, 'x') setChatVar(id, 'after', '1') end`, { kind: 'start' }))).toMatchObject({ missing: ['generateImage'], writes: [['after', '1']] });
    expect(await run(`onStart = async(function(id) local image = generateImage(id, 'x'):await() setChatVar(id, 'after', tostring(image)) end)`, { kind: 'start' })).toMatchObject({ errors: [], missing: ['generateImage'], writes: [['after', 'nil']] });
    expect((await run(`syntax error here`, { kind: 'start' })).errors).toHaveLength(1);
    expect((await run(`function onStart(id) while true do end end`, { kind: 'start' })).errors[0]).toMatchObject({ message: expect.stringContaining('timeout') });
  });

  it('evaluates CBS with the run\'s writes, reads the lorebook by name and as the prompt would hold it, and takes a whole chat', async () => {
    const outcome = await run(
      `onOutput = async(function(id)
        setChatVar(id, 'hp', '4')
        setChatVar(id, 'cbs', cbs('{{getvar::hp}}/{{user}}/{{getglobalvar::toggle_hard}}'))
        local gate = getLoreBooks(id, 'Gate')[1]
        setChatVar(id, 'gate', gate.key .. '|' .. gate.content .. '|' .. gate.insertorder .. '|' .. #getLoreBooks(id, 'None'))
        local active = loadLoreBooks(id)[1]
        setChatVar(id, 'active', active.role .. ':' .. active.data)
        setFullChat(id, { { role = 'user', data = 'hello!' }, { role = 'user', data = 'again' }, { role = 'char', data = 'new' } })
      end)`,
      { kind: 'output' },
    );
    expect(outcome.errors).toEqual([]);
    expect(new Map(outcome.writes)).toEqual(new Map([['hp', '4'], ['cbs', '4/Jin/1'], ['gate', 'gate, door|hp 4|7|0'], ['active', 'char:active']]));
    expect(outcome).toMatchObject({ edits: [{ index: 0, text: 'hello!' }], removed: [1], added: [{ role: 'user', text: 'again' }, { role: 'char', text: 'new' }] });
  });

  it("writes the chat's own lorebook by name with Risu's defaults, and reads its writes back in the same run", async () => {
    const chat = 'lore-chat';
    const own = { id: 'own', parent: chat, value: { ...SNAPSHOT.scope.lore[0]!.value, content: 'old' } };
    const snapshot = { ...SNAPSHOT, scope: { ...SNAPSHOT.scope, lore: [...SNAPSHOT.scope.lore, own] } };
    const code = `function onStart(id)
      upsertLocalLoreBook(id, 'Gate', 'first', { alwaysActive = true })
      upsertLocalLoreBook(id, 'Gate', 'new {{getvar::hp}}', { key = 'a, b', secondKey = 'c', regex = true })
      upsertLocalLoreBook(id, 'Plain', 'plain')
      local books = getLoreBooks(id, 'Gate')
      setChatVar(id, 'gate', #books .. '|' .. books[1].content .. '|' .. books[2].content)
    end`;
    const outcome = await lua.run(chat, [{ owner: OWNER, kind: 'lua', name: 'main', code }], snapshot, { kind: 'start' }, host(), 'event');
    expect(outcome.errors).toEqual([]);
    expect(new Map(outcome.writes)).toEqual(new Map([['gate', '2|new 10|hp 10']]));
    const entry = { secondaryKeys: [], enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: null };
    expect(outcome.lore).toEqual([
      { ...entry, name: 'Gate', keys: ['a', 'b'], secondaryKeys: ['c'], content: 'new {{getvar::hp}}', selective: true, useRegex: true },
      { ...entry, name: 'Plain', keys: [], content: 'plain' },
    ]);
  });

  it("keeps a preview's Lua globals apart from the events' of the same owner, both ways", async () => {
    const scripts: Script[] = [{ owner: OWNER, kind: 'lua', name: 'main', code: `seen = seen or 'unset'
function onStart(id) setChatVar(id, 'seen', seen) seen = getChatVar(id, 'set') end` }];
    const start = async (lane: 'event' | 'preview', set: string) => (await lua.run('lanes', scripts, { ...SNAPSHOT, variables: [['set', set]] }, { kind: 'start' }, host(), lane)).writes;
    expect(await start('event', 'from event')).toEqual([['seen', 'unset']]);
    expect(await start('preview', 'from preview')).toEqual([['seen', 'unset']]);
    expect(await start('event', 'again')).toEqual([['seen', 'from event']]);
    expect(await start('preview', 'again')).toEqual([['seen', 'from preview']]);
  });

  it('puts an inserted message ahead of the one at its index', async () => {
    const outcome = await run(`function onStart(id) insertChat(id, 1, 'user', 'between') addChat(id, 'char', 'tail') end`, { kind: 'start' });
    expect(outcome.added).toEqual([{ role: 'user', text: 'between', before: 1 }, { role: 'char', text: 'tail', before: null }]);
    expect(outcome).toMatchObject({ edits: [], removed: [] });
  });

  it('gives a script no way out of the sandbox', async () => {
    const outcome = await run(
      `function onStart(id)
        setChatVar(id, 'libs', tostring(io) .. tostring(load) .. tostring(debug) .. tostring(package) .. tostring(os.execute) .. tostring(dofile))
        setChatVar(id, 'date', type(os.date('%Y')))
        setChatVar(id, 'api', type(getChatVar) .. tostring(pcall(function() return getChatVar.constructor end)))
        setChatVar(id, 'require', tostring(require('json') == json) .. tostring(pcall(require, 'os')))
      end`,
      { kind: 'start' },
    );
    expect(new Map(outcome.writes)).toEqual(new Map([['libs', 'nil'.repeat(6)], ['date', 'string'], ['api', 'functionfalse'], ['require', 'truefalse']]));
  });
});

it('keeps initialization log output once with the first hook of that engine', async () => {
  const scripts: Script[] = [{ owner: OWNER, kind: 'lua', name: 'initial', code: `log('loaded')
function onStart(id) log('started') end` }];
  const first = await lua.run('initial-log', scripts, SNAPSHOT, { kind: 'start' }, host(), 'event');
  expect(first.trace.entries.map(({ stage, logs }) => [stage, logs])).toEqual([['load', ['"loaded"']], ['onStart', ['"started"']]]);
  const next = await lua.run('initial-log', scripts, SNAPSHOT, { kind: 'start' }, host(), 'event');
  expect(next.trace.entries.map(({ stage }) => stage)).toEqual(['onStart']);
});

describe('Lua display', () => {
  it('answers a refused call Risu declares async with a promise, for :await() to read as nil', async () => {
    const code = `listenEdit('editDisplay', function(id, value) return value .. ':' .. (getTokens(id, 'x') == nil and 'nil' or 'promise') .. ':' .. (alertNormal(id, 'x') == nil and 'nil' or 'promise') end)`;
    await lua.installDisplay('refused', 1, [{ owner: OWNER, kind: 'lua', name: 'main', code }], SNAPSHOT, [{ index: 0, text: 'a', variables: [] }]);
    expect((await lua.display('refused', 1, 1)).texts).toEqual(['a:promise:nil']);
  });

  it('edits each message with the state as of it and keeps none of its writes or acts', async () => {
    const code = `listenEdit('editDisplay', function(id, value, meta)
        log(value)
        alertNormal(id, 'never')
        setChat(id, 0, 'never')
        local hp = getChatVar(id, 'hp')
        setChatVar(id, 'hp', 'changed')
        return value .. ':' .. meta.index .. ':' .. hp .. ':' .. getChat(id, 0).data
      end)`;
    await lua.installDisplay('display', 1, [{ owner: OWNER, kind: 'lua', name: 'main', code }], SNAPSHOT, [
      { index: 0, text: 'a', variables: [] },
      { index: 1, text: 'b', variables: [['hp', '4']] },
    ]);
    const shown = await lua.display('display', 1, 2);
    expect(shown).toMatchObject({ texts: ['a:0:10:hello', 'b:1:4:hello'], listening: [true], errors: [], missing: [], from: 0, remaining: 0 });
    expect(shown.trace?.entries.map(({ stage, logs, writes, changed }) => ({ stage, logs, writes, changed }))).toEqual(['a', 'b'].map((text) => ({ stage: 'editDisplay', logs: [JSON.stringify(text)], writes: [['hp', 'changed']], changed: true })));
  });

  it('retains full-chat reads while walking newest-first variable deltas and replacing a revision', async () => {
    const scripts: Script[] = [{ owner: OWNER, kind: 'lua', name: 'state', code: "listenEdit('editDisplay', function(id, value) return value .. ':' .. getChatVar(id, 'hp') .. ':' .. getChatVar(id, 'x') .. ':' .. getChatLength(id) end)" }];
    const items = [
      { index: 0, text: 'a', variables: [['hp', '1']] as [string, string][] },
      { index: 1, text: 'b', variables: [['x', 'a']] as [string, string][] },
      { index: 2, text: 'c', variables: [['hp', '7']] as [string, string][] },
      { index: 3, text: 'd', variables: [['x', 'b']] as [string, string][] },
    ];
    await lua.installDisplay('retained', 1, scripts, SNAPSHOT, items);
    expect(await lua.display('retained', 1, 2)).toMatchObject({ texts: ['c:7:a:2', 'd:7:b:2'], from: 2, remaining: 2 });
    expect(await lua.display('retained', 1, 2)).toMatchObject({ texts: ['a:1:null:2', 'b:1:a:2'], from: 0, remaining: 0 });
    await lua.installDisplay('retained', 2, scripts, { ...SNAPSHOT, messages: [] }, items);
    await expect(lua.display('retained', 1, 2)).rejects.toThrow('expired');
    expect((await lua.display('retained', 2, 1)).texts).toEqual(['d:7:b:0']);
    lua.forgetDisplay('retained', 2);
    await expect(lua.display('retained', 2, 1)).rejects.toThrow('expired');
  });

  it('says which scripts listen by what their engines registered, a computed name too, not by their source', async () => {
    const scripts = [`-- editDisplay editRequest\nfunction onStart(id) end`, `listenEdit('edit' .. 'Display', function(id, value) return value .. '!' end)`].map((code): Script => ({ owner: OWNER, kind: 'lua', name: 'main', code }));
    await lua.installDisplay('listening', 1, scripts, SNAPSHOT, [{ index: 0, text: 'a', variables: [] }]);
    expect(await lua.display('listening', 1, 1)).toMatchObject({ texts: ['a!'], listening: [false, true] });
    const request = [{ role: 'user', content: 'a' }];
    expect(await lua.run('listening', [scripts[0]!], SNAPSHOT, { kind: 'edit', stage: 'editRequest', value: request, meta: {} }, host(), 'event')).toMatchObject({ value: request, handled: false });
    const computed = `listenEdit('edit' .. 'Request', function(id, value) value[1].content = 'b' return value end)`;
    expect(await run(computed, { kind: 'edit', stage: 'editRequest', value: request, meta: {} })).toMatchObject({ value: [{ role: 'user', content: 'b' }], handled: true });
  });
});

describe('block triggers', () => {
  it('preserves text equality for conditions and numeric equality for branches after wire normalization', async () => {
    const set = { type: 'setvar', operator: '=', var: 'answer', value: '{{getvar::hp}}' };
    const condition = blocks('start', [set], [{ type: 'value', var: '01', operator: '=', value: '1' }]);
    const branch = blocks('start', [
      { type: 'v2IfAdvanced', source: '01', sourceType: 'value', condition: '=', target: '1', indent: 0 },
      set,
      { type: 'v2EndIndent', indent: 1 },
    ]);
    expect((await lua.run(String(owner++), [condition], SNAPSHOT, { kind: 'start' }, host(), 'event')).writes).toEqual([]);
    expect((await lua.run(String(owner++), [branch], SNAPSHOT, { kind: 'start' }, host(), 'event')).writes).toEqual([['answer', '10']]);
  });

  it('run on their own event when their conditions pass, in one run with the Lua around them', async () => {
    const bonus = blocks('start', [{ type: 'setvar', operator: '+=', var: 'hp', value: '5' }], [{ type: 'var', var: 'hp', operator: '>=', value: '{{getvar::hp}}' }]);
    const seen: Script = { owner: OWNER, kind: 'lua', name: 'main', code: `function onStart(id) setChatVar(id, 'seen', getChatVar(id, 'hp')) end` };
    const refused = blocks('start', [{ type: 'setvar', operator: '=', var: 'hp', value: '0' }], [{ type: 'var', var: 'hp', operator: 'null' }]);
    const triggers = [bonus, seen, refused, blocks('output', [{ type: 'setvar', operator: '=', var: 'late', value: '1' }])];
    expect(await lua.run(String(owner++), triggers, SNAPSHOT, { kind: 'start' }, host(), 'event')).toMatchObject({ errors: [], writes: [['hp', '15'], ['seen', '15']] });
  });

  it("read the pressed element's risu-id as {{triggerid}} in the run the press calls, and in no other", async () => {
    const pressed = blocks('manual', [{ type: 'setvar', operator: '=', var: 'door', value: '[{{triggerid}}]' }]);
    const script: Script = { owner: OWNER, kind: 'lua', name: 'main', code: `function blocks(id) setChatVar(id, 'lua', cbs('[{{triggerid}}]')) end` };
    const press = async (id: string) => (await lua.run(String(owner++), [pressed, script], SNAPSHOT, { kind: 'call', name: 'blocks', id }, host(), 'event')).writes;
    expect(await press('north')).toEqual([['door', '[north]'], ['lua', '[north]']]);
    expect(await press('')).toEqual([['door', '[null]'], ['lua', '[null]']]);
  });

  it('take the branch of a v2 if that holds, reading operands as texts or as variable names', async () => {
    const branch = blocks('start', [
      { type: 'v2Header', indent: 0 },
      { type: 'v2IfAdvanced', condition: '>', source: 'hp', sourceType: 'var', target: '5', targetType: 'value', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'size', value: 'big', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1 },
      { type: 'v2Else', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'size', value: 'small', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1 },
      { type: 'v2SetVar', operator: '=', var: 'after', value: 'size', valueType: 'var', indent: 0 },
    ]);
    const at = async (hp: string) => (await lua.run(String(owner++), [branch], { ...SNAPSHOT, variables: [['hp', hp]] }, { kind: 'start' }, host(), 'event')).writes;
    expect(await at('10')).toEqual([['size', 'big'], ['after', 'big']]);
    expect(await at('3')).toEqual([['size', 'small'], ['after', 'small']]);
  });

  it('write to the chat and stop the turn as Lua does', async () => {
    const outcome = await lua.run(String(owner++), [blocks('output', [
      { type: 'modifychat', index: '1', value: 'hp {{getvar::hp}}' },
      { type: 'impersonate', role: 'user', value: 'more' },
      { type: 'cutchat', start: '1', end: '3' },
      { type: 'stop' },
    ])], SNAPSHOT, { kind: 'output' }, host(), 'event');
    expect(outcome).toMatchObject({ errors: [], stop: true, edits: [{ index: 1, text: 'hp 10' }], removed: [0], added: [{ role: 'user', text: 'more' }] });
  });

  it('run a /cut command by its intent and name any other command as missing', async () => {
    const cut = async (value: string) => (await lua.run(String(owner++), [blocks('start', [{ type: 'v2Command', value, valueType: 'value', indent: 0 }])], SNAPSHOT, { kind: 'start' }, host(), 'event')).removed;
    expect(await cut('/cut -1')).toEqual([1]);
    expect(await cut('/cut 1-3')).toEqual([0]);
    expect(await cut('/cut 0')).toEqual([0]);
    const outcome = await lua.run(String(owner++), [blocks('start', [{ type: 'command', value: '/send hi', indent: 0 }])], SNAPSHOT, { kind: 'start' }, host(), 'event');
    expect(outcome).toMatchObject({ missing: ['command /send'], removed: [] });
  });

  it('name an effect this app lacks and go on', async () => {
    const outcome = await lua.run(String(owner++), [blocks('start', [{ type: 'v2ImgGen', indent: 0 }, { type: 'setvar', operator: '=', var: 'after', value: '1' }])], SNAPSHOT, { kind: 'start' }, host(), 'event');
    expect(outcome).toMatchObject({ missing: ['v2ImgGen'], writes: [['after', '1']] });
  });

  it('gather the chat in a loop and the lorebook by Risu’s index, its folders first, for the model they name', async () => {
    const entry = (id: string, content: string) => ({ id, parent: OWNER.id, value: { ...SNAPSHOT.scope.lore[0]!.value, name: id, content } });
    const scope = { ...SNAPSHOT.scope, greeting: { index: 0 }, messages: [{ id: 'g', message: 'g', seed: 'g', role: 'assistant' as const, text: 'welcome', time: null }], lore: [entry('a', 'A {{getvar::hp}}'), entry('b', 'B')], loreFolders: { [OWNER.id]: ['folder'] } };
    const model = vi.fn<Host['model']>(async () => ({ success: true, result: 'answer' }));
    const outcome = await lua.run(String(owner++), [blocks('start', [
      { type: 'v2GetMessageCount', outputVar: 'count', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'i', value: '0', valueType: 'value', indent: 0 },
      { type: 'v2GetFirstMessage', outputVar: 'all', indent: 0 },
      { type: 'v2LoopNTimes', value: 'count', valueType: 'var', indent: 0 },
      { type: 'v2GetMessageAtIndex', index: 'i', indexType: 'var', outputVar: 'read', indent: 1 },
      { type: 'v2ConcatString', source1: 'all', source1Type: 'var', source2: 'read', source2Type: 'var', outputVar: 'all', indent: 1 },
      { type: 'v2SetVar', operator: '+=', var: 'i', value: '1', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1, endOfLoop: true },
      { type: 'v2Calculate', expression: '{{getvar::i}}-1', expressionType: 'value', outputVar: 'at', indent: 0 },
      { type: 'v2GetLorebookByIndex', index: 'at', indexType: 'var', outputVar: 'book', indent: 0 },
      { type: 'v2RunLLM', value: '{{getvar::all}}|{{getvar::book}}', valueType: 'value', outputVar: 'out', model: 'submodel', indent: 0 },
      { type: 'v2Impersonate', role: 'char', value: 'out', valueType: 'var', indent: 0 },
      { type: 'v2StopPromptSending', indent: 0 },
    ])], { ...SNAPSHOT, scope }, { kind: 'start' }, host({ model }), 'event');
    expect(outcome).toMatchObject({ errors: [], missing: [], stop: true, added: [{ role: 'char', text: 'answer' }] });
    expect(model).toHaveBeenCalledWith('aux', [{ role: 'user', content: 'welcomehellohi there|A 10' }], OWNER);
  });

  it('edit texts, arrays and dictionaries in variables, and ask with the question they show', async () => {
    const ask = vi.fn<Host['ask']>(async () => '1');
    const outcome = await lua.run(String(owner++), [blocks('start', [
      { type: 'v2GetLastCharMessage', outputVar: 'last', indent: 0 },
      { type: 'v2ReplaceString', source: 'last', sourceType: 'var', regex: 'there', regexType: 'value', result: '{{user}}', resultType: 'value', replacement: '', replacementType: 'value', flags: '', flagsType: 'value', outputVar: 'last', indent: 0 },
      { type: 'v2ModifyChat', index: '1', indexType: 'value', value: 'last', valueType: 'var', indent: 0 },
      { type: 'v2SplitString', source: 'a,b', sourceType: 'value', delimiter: ',', delimiterType: 'value', outputVar: 'list', indent: 0 },
      { type: 'v2PushArrayVar', var: 'list', value: 'c', valueType: 'value', indent: 0 },
      { type: 'v2PopArrayVar', var: 'list', outputVar: 'popped', indent: 0 },
      { type: 'v2JoinArrayVar', var: 'list', varType: 'var', delimiter: '+', delimiterType: 'value', outputVar: 'joined', indent: 0 },
      { type: 'v2SetDictVar', var: 'dict', varType: 'var', key: 'k', keyType: 'value', value: 'v', valueType: 'value', indent: 0 },
      { type: 'v2GetDictVar', var: 'dict', varType: 'var', key: 'k', keyType: 'value', outputVar: 'got', indent: 0 },
      { type: 'v2RegexTest', value: 'joined', valueType: 'var', regex: '^a\\+', regexType: 'value', flags: '', flagsType: 'value', outputVar: 'matched', indent: 0 },
      { type: 'v2GetAlertSelect', display: '고르기', displayType: 'value', value: '하나|둘', valueType: 'value', outputVar: 'picked', indent: 0 },
    ])], SNAPSHOT, { kind: 'start' }, host({ ask }), 'event');
    expect(outcome).toMatchObject({ errors: [], missing: [], edits: [{ index: 1, text: 'hi Jin' }] });
    expect(Object.fromEntries(outcome.writes)).toMatchObject({ list: '["a","b"]', popped: 'c', joined: 'a+b', dict: '{"k":"v"}', got: 'v', matched: '1', picked: '1' });
    expect(ask).toHaveBeenCalledWith({ kind: 'select', text: '고르기', options: ['하나', '둘'] }, OWNER);
  });

  it('hide a chat variable behind a local one, break loops, skip a loop of no turns and run other triggers by name', async () => {
    const module = { kind: 'module', id: 'module' } as const;
    const helper = { ...blocks('manual', [{ type: 'v2SetVar', operator: '=', var: 'helped', value: '1', valueType: 'value', indent: 0 }]), name: 'helper', owner: module };
    const main = blocks('manual', [
      { type: 'v2DeclareLocalVar', var: 'hp', value: 'local', valueType: 'value', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'seen', value: 'hp', valueType: 'var', indent: 0 },
      { type: 'v2Loop', indent: 0 },
      { type: 'v2SetVar', operator: '+=', var: 'n', value: '1', valueType: 'value', indent: 1 },
      { type: 'v2IfAdvanced', condition: '>=', source: 'n', sourceType: 'var', target: '3', targetType: 'value', indent: 1 },
      { type: 'v2BreakLoop', indent: 2 },
      { type: 'v2EndIndent', indent: 2 },
      { type: 'v2EndIndent', indent: 1, endOfLoop: true },
      { type: 'v2LoopNTimes', value: '0', valueType: 'value', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'never', value: '1', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1, endOfLoop: true },
      { type: 'v2RunTrigger', target: 'helper', indent: 0 },
      { type: 'v2ShowAlert', value: 'back', valueType: 'value', indent: 0 },
    ]);
    const say = vi.fn();
    const outcome = await lua.run(String(owner++), [main, helper], SNAPSHOT, { kind: 'call', name: 'blocks', id: '' }, host({ say }), 'event');
    expect(outcome).toMatchObject({ errors: [], writes: [['seen', 'local'], ['n', '3'], ['helped', '1']] });
    expect(say).toHaveBeenCalledWith('normal', 'back', OWNER);
    const itself = blocks('manual', [{ type: 'v2RunTrigger', target: 'blocks', indent: 0 }]);
    const looped = await lua.run(String(owner++), [itself], SNAPSHOT, { kind: 'call', name: 'blocks', id: '' }, host(), 'event');
    expect(looped.errors[0]).toMatchObject({ message: 'triggers ran each other more than 10 deep' });
  });
});

it('passes the owner of each Lua and block script through its host calls', async () => {
  const module = { kind: 'module', id: 'module' } as const;
  const model = vi.fn<Host['model']>(async () => ({ success: true, result: 'answer' }));
  const say = vi.fn();
  const ask = vi.fn(async () => null);
  const outcome = await lua.run('owners', [
    { owner: OWNER, kind: 'lua', name: 'card', code: 'onStart = async(function(id) LLM(id, {{role="user", content="card"}}) end)' },
    { owner: module, kind: 'lua', name: 'module', code: 'onStart = async(function(id) LLM(id, {{role="user", content="module"}}); alertNormal(id, "module") end)' },
    { ...blocks('start', [{ type: 'showAlert', alertType: 'input', value: 'ask', inputVar: 'answer' }]), owner: module },
  ], SNAPSHOT, { kind: 'start' }, host({ model, say, ask }), 'event');
  expect(outcome.errors).toEqual([]);
  expect(model.mock.calls).toEqual([['main', [{ role: 'user', content: 'card' }], OWNER], ['main', [{ role: 'user', content: 'module' }], module]]);
  expect(say).toHaveBeenCalledWith('normal', 'module', module);
  expect(ask).toHaveBeenCalledWith({ kind: 'input', text: 'ask' }, module);
});

it('ranks similarity’s values by likeness to its source, the source embedded as a search, and answers nil when refused', async () => {
  const vectors: Record<string, number[]> = { 비: [1, 0], 맑음: [0, 1], 소나기: [0.9, 0.1], 흐림: [0.5, 0.5] };
  const embed = vi.fn<Host['embed']>(async (texts) => ({ ok: true, model: 'm', vectors: texts.map((each) => vectors[each]!) }));
  const code = (name: string) => `onStart = async(function(id) local ranked = similarity(id, '비', {'맑음', '흐림', '소나기'}):await() setChatVar(id, '${name}', ranked and table.concat(ranked, ',') or 'nil') end)`;
  const ranked = await run(code('ranked'), { kind: 'start' }, { embed });
  expect(ranked).toMatchObject({ errors: [], missing: [], writes: [['ranked', '소나기,흐림,맑음']] });
  expect(embed.mock.calls.map(([texts, as, spender]) => [texts, as, spender])).toEqual([[['비'], 'query', OWNER], [['맑음', '흐림', '소나기'], 'document', OWNER]]);
  const refused = await run(code('refused'), { kind: 'start' }, { embed: async () => ({ ok: false, reason: 'not-allowed' }) });
  expect(refused.writes).toEqual([['refused', 'nil']]);
});

describe('Lua check', () => {
  it('reports a draft’s first syntax error by line, and runs nothing', async () => {
    expect(await lua.check('function onStart(id)\n  setChatVar(id, "x", 1)\nend')).toBeNull();
    expect(await lua.check('function onStart(id)\n  if x then\nend')).toEqual({ line: 3, message: "'end' expected (to close 'function' at line 1) near <eof>" });
    expect(await lua.check('error("ran")')).toBeNull();
  });
});
