import { importModule, setModuleAlways } from './modules';
import { importTool, toolBadges, toolChatData } from './tools/store';
import { editShown } from './message-acts';
import { readTool } from '../engine/import/tool';
import type { ToolUnit } from '../model/tool';
import { toolVar } from '../tool-api/manifest';
import { noOutcome, type Binding } from './script-binding';
import type { ScriptOutcome } from './lua/event';
import { gatherTurn, wouldSend } from './turn-context';
import type { LuaRunner } from './script-binding';
import { describe, expect, it, vi } from 'vitest';
import type { ToggleLine } from '../model/prompt';
import { fetchApi } from './api';
import type { Trigger } from '../engine/import/types';
import { Lua } from '../engine/lua/run';
import type { ToolEvent } from '../engine/script-api';
import { fold, shown } from '../model/chat';
import { modelUsage } from '../model/usage';
import { setToggle } from './characters';
import { appendUserMessage, selectVersion, startChat, type Written } from './chat-log';
import { EvaluationFailed, EvaluationStuck } from './evaluation';
import { projectGreetings } from './greetings';

import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { blankCard } from '../engine/import/card';
import { chatNow, evaluateChat } from './chat-context';
import { NOT_REHEARSED } from './script-preview';
import { SCRIPT_LOG_LIMITS } from './script-journal';
import { triggersOf } from './script-selection';
import type { TurnContext } from './turn-context';
import { takeTurn } from './turn';

const server = testServer();

async function chatWith(session: Session, script: string | Trigger[], toggles: ToggleLine[] = []) {
  await answerable(session);
  const triggers: Trigger[] = typeof script === 'string' ? [{ kind: 'lua', id: 'trigger-0', name: 'main', code: script }] : script;
  const card = { ...blankCard('루나'), greetings: ['어서 와.'], description: 'turn {{getvar::turn}}', triggers, toggles };
  const character = await session.store.create('character', { card, folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const greeting = crypto.randomUUID();
  await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, projectGreetings(card.greetings, [greeting], 0));
  const messages = () => fold(session.store.children('entry', chat));
  const shownTexts = async () => (await evaluateChat(session, chat, session.store.get('chat', chat)!.value, messages())).texts;
  return { chat, messages, shownTexts };
}

describe('triggersOf', () => {
  it('leaves out a trigger turned off and a Lua one with no code', () => {
    const lua = (id: string, code: string, off?: true): Trigger => ({ kind: 'lua', id, name: id, code, ...(off && { off }) });
    expect(triggersOf([{ id: 'c', module: null, pack: { regex: [], triggers: [lua('a', 'x()'), lua('b', ' \n'), lua('c', 'y()', true)], toggles: [] } }]).map(({ id }) => id)).toEqual(['a']);
  });
});

describe("a turn with the bot's Lua", () => {
  it('runs input, start, the edit hooks and output in order, saving what each wrote where the story replays it', () =>
    server.withSession(async (session) => {
      const { chat, messages, shownTexts } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'order', 'input') end
        listenEdit('editInput', function(id, value) return value .. ' [' .. getChatVar(id, 'order') .. ']' end)
        function onStart(id)
          setChatVar(id, 'turn', getChatLength(id) .. ':' .. getChat(id, -1).data)
          addChat(id, 'char', 'narration')
        end
        listenEdit('editOutput', function(id, value) return value .. ' (' .. getChatVar(id, 'turn') .. ')' end)
        listenEdit('edit' .. 'Request', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)
        function onOutput(id)
          setState(id, 'seen', getChat(id, -1).data)
          setChat(id, -1, getChat(id, -1).data .. '!')
        end`,
      );
      const log = stubRelay(() => saying('왔구나 {{getvar::turn}}'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => messages().length).toBe(4);

      const [, said, narration, reply] = messages();
      expect(shown(said!)).toMatchObject({ text: '안녕 [input]', before: [['order', 'input']] });
      expect(shown(narration!)).toMatchObject({ text: 'narration', staged: true });
      await expect.poll(() => shown(messages()[3]!).edited).toBe(true);
      expect(shown(messages()[3]!)).toMatchObject({ text: '왔구나 1:안녕 [input] (1:안녕 [input])!', staged: true, before: [['turn', '1:안녕 [input]']], after: [['__seen', '"왔구나 1:안녕 [input] (1:안녕 [input])"']] });
      expect(reply!.versions).toHaveLength(1);
      expect((await shownTexts()).at(-1)).toBe('왔구나 1:안녕 [input] (1:안녕 [input])!');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('turn 1:안녕 [input]');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('narration');
      expect((JSON.parse(log[0]!.sent.body!) as { messages: unknown[] }).messages.at(-1)).toEqual({ role: 'system', content: 'from lua' });
      const prompt = session.log.entry(chat, shown(reply!).receipt!.id)!.prompt!;
      expect(prompt.parts).toHaveLength(prompt.messages.length);
      expect(prompt.parts.at(-1)).toMatchObject({ from: { kind: 'script' } });
    }));

  it("hands editOutput the number the reply takes, the greeting's being -1, again when it is made anew", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editOutput', function(id, value, meta) return value .. '#' .. meta.index end)`);
      stubRelay(inTurn([saying('a'), saying('b')]));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      expect(shown(messages()[2]!).text).toBe('a#1');
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: messages()[2]!.id })).toBeNull();
      expect(shown(messages()[2]!).text).toBe('b#1');
    }));

  it("hands editRequest each chat message's id as its memo, and sends the model none", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `listenEdit('editRequest', function(id, value)
          local seen = {}
          for _, message in ipairs(value) do seen[#seen + 1] = message.role .. '=' .. (message.memo or '-') end
          value[#value + 1] = { role = 'system', content = table.concat(seen, ' '), memo = 'kept?' }
          return value
        end)`,
      );
      const log = stubRelay(() => saying('응'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => log.length).toBe(1);
      const sent = (JSON.parse(log[0]!.sent.body!) as { messages: Record<string, unknown>[] }).messages;
      expect(sent.at(-1)!.content).toMatch(new RegExp(`^((system|assistant)=- )+assistant=- user=${messages()[1]!.id}$`));
      expect(sent.every((message) => !('memo' in message))).toBe(true);
    }));

  it("sends what onStart wrote to the chat's own lorebook with this turn, and keeps it under the chat", () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `function onStart(id) upsertLocalLoreBook(id, 'Gate', 'the gate is shut', { alwaysActive = true }) end`);
      const log = stubRelay(() => saying('응'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => log.length).toBe(1);
      expect(JSON.stringify(log[0]!.sent.body)).toContain('the gate is shut');
      expect(session.store.children('lore', chat).map(({ value }) => [value.name, value.content, value.constant])).toEqual([['Gate', 'the gate is shut', true]]);
    }));

  it('ends the turn before any request on stopChat, keeping the message and what was written', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function onStart(id) setChatVar(id, 'handled', getChat(id, -1).data) stopChat(id) end`);
      const log = stubRelay(() => saying('never'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '/roll' })).toBeNull();
      expect(log).toHaveLength(0);
      expect(shown(messages()[1]!)).toMatchObject({ text: '/roll', after: [['handled', '/roll']] });
      expect(session.scriptInteractions.snapshot().notes).toEqual([]);
    }));

  it('ends the turn on a stopChat from onInput, running nothing after it, keeping the message with what was written and saying so', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'seen', '1') stopChat(id) end
        listenEdit('editInput', function(id, value) return value .. ' edited' end)
        function onStart(id) setChatVar(id, 'started', '1') end`,
      );
      const log = stubRelay(() => saying('never'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '/roll' })).toBeNull();
      expect(log).toHaveLength(0);
      expect(messages()).toHaveLength(2);
      expect(shown(messages()[1]!)).toMatchObject({ text: '/roll', before: [['seen', '1']] });
      expect(shown(messages()[1]!).after).toBeUndefined();
      expect(session.scriptInteractions.snapshot().notes).toMatchObject([{ chat, kind: 'input-stop' }]);
    }));

  it("asks before the bot's first model call, keeps the answer on the character, counts the call in the chat's usage, and ends it on the server", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `onOutput = async(function(id) setChatVar(id, 'made', LLM(id, { { role = 'user', content = 'sum' } }).result) end)`);
      const character = session.store.get('chat', chat)!.value.character!;
      const log = stubRelay(inTurn([saying('reply'), saying('summary')]));
      const served = globalThis.fetch;
      const calls: string[] = [];
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/streams/') && init?.method === 'POST') calls.push(url);
        return served(url, init);
      });
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toMatchObject([{ chat, question: { kind: 'model' } }]);
      expect(log).toHaveLength(1);
      session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      await expect.poll(() => shown(messages()[2]!).after).toEqual([['made', 'summary']]);
      expect(session.store.get('character', character)!.value.botModels).toBe(true);
      expect((JSON.parse(log[1]!.sent.body!) as { messages: unknown }).messages).toEqual([{ role: 'user', content: 'sum' }]);
      expect(shown(messages()[2]!).calls).toMatchObject([{ receipt: { state: 'done', model: 'm' } }]);
      const ledger = await session.usage.read(new AbortController().signal);
      expect(ledger.ok && modelUsage(ledger.data, shown(messages()[2]!).receipt!.connection, 'm').calls).toBe(2);
      expect(calls).toHaveLength(2);
      await vi.waitFor(async () => expect((await fetchApi(calls[1]!.slice('/api/'.length))).status).toBe(404));
    }));

  it("asks once per character before a script rewrites the card's background, and keeps the answer on the character", () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `onButtonClick = async(function(id, data) setBackgroundEmbedding(id, data) end)`);
      const character = session.store.get('chat', chat)!.value.character!;
      const pressing = session.scriptCommands.press(chat, { data: '<style>.a{}</style>' }).answered;
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toMatchObject([{ chat, question: { kind: 'card' } }]);
      session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      await pressing;
      expect(session.store.get('character', character)!.value).toMatchObject({ cardWrites: true, card: { background: '<style>.a{}</style>' } });
      await session.scriptCommands.press(chat, { data: '<style>.b{}</style>' }).answered;
      expect(session.scriptInteractions.snapshot().questions).toEqual([]);
      expect(session.store.get('character', character)!.value.card.background).toBe('<style>.b{}</style>');
    }));

  it("tells the chat when the server turns its bot's model call away for coming too often", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `onOutput = async(function(id) setChatVar(id, 'made', LLM(id, { { role = 'user', content = 'sum' } }).result) end)`);
      stubRelay(inTurn([saying('reply')]));
      const served = globalThis.fetch;
      let starts = 0;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
        url.startsWith('/api/streams/') && init?.method === 'POST' && starts++ ? Promise.resolve(Response.json({ error: 'too-many-bot-calls' }, { status: 429 })) : served(url, init),
      );
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toHaveLength(1);
      session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      await expect.poll(() => shown(messages()[2]!).after).toEqual([['made', 'Error: too many model calls in a minute']]);
      expect(session.scriptInteractions.snapshot().notes).toMatchObject([{ chat, kind: 'flood' }]);
    }));

  it("answers a button with the script's function and keeps its writes after the last message", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function open(id) setChatVar(id, 'door', 'open') alertNormal(id, 'opened') end`);
      expect(await session.scriptCommands.press(chat, { trigger: 'open', id: '' }).answered).toBe(true);
      expect(await session.scriptCommands.press(chat, { trigger: 'missing', id: '' }).answered).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(session.scriptInteractions.snapshot().notes).toMatchObject([{ chat, kind: 'said', tone: 'normal', text: 'opened' }]);
    }));

  it('says a press waits behind a run calling a model, and joins the same button pressed again before it begins', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `slow = async(function(id) LLM(id, { { role = 'user', content = 'sum' } }) end)
        function count(id) setChatVar(id, 'n', tostring((tonumber(getChatVar(id, 'n')) or 0) + 1)) end`);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const reply = saying('summary');
      stubRelay(() => new Response(new ReadableStream({ async start(body) { await held; body.enqueue(new Uint8Array(await reply.arrayBuffer())); body.close(); } }), { headers: reply.headers }));
      const slow = session.scriptCommands.press(chat, { trigger: 'slow', id: '' });
      expect(slow.waits).toBe(false);
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toHaveLength(1);
      session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      const first = session.scriptCommands.press(chat, { trigger: 'count', id: '' });
      const again = session.scriptCommands.press(chat, { trigger: 'count', id: '' });
      expect([first.waits, again.waits, again.answered === first.answered]).toEqual([true, true, true]);
      release();
      expect(await first.answered).toBe(true);
      expect(messages()[0]!.after).toEqual([['n', '1']]);
    }));

  it('keeps replayed CBS writes on Lua-edited versions after worker-side snapshot preparation', () =>
    server.withSession(async (session) => {
      const { chat, messages, shownTexts } = await chatWith(session, `function edit(id) setChat(id, 0, getChat(id, 0).data .. '!') end`);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '{{setvar::hp::7}}health {{getvar::hp}}' });
      expect(await session.scriptCommands.press(chat, { trigger: 'edit', id: '' }).answered).toBe(true);
      expect(shown(messages()[1]!)).toMatchObject({ text: 'health 7!', staged: true, before: [['hp', '7']] });
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'still {{getvar::hp}}' });
      expect((await shownTexts()).slice(-2)).toEqual(['health 7!', 'still 7']);
    }));

  it("tells a script's cbs() that ran away as the runaway note, not as its error", () =>
    server.withSession(async (session) => {
      const doubling = "'{{settempvar::x::abcdefghijklmnop}}' .. string.rep('{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}', 22)";
      const { chat } = await chatWith(session, `function grow(id) cbs(${doubling}) end`);
      expect(await session.scriptCommands.press(chat, { trigger: 'grow', id: '' }).answered).toBe(true);
      expect(session.scriptInteractions.snapshot().notes).toMatchObject([{ chat, kind: 'runaway' }]);
    }));

  it('tells a display that did not end as the stuck note, not as an error', () =>
    server.withSession(async (session) => {
      session.scriptJournal.report('c', new EvaluationStuck('Evaluation worker stuck', true));
      expect(session.scriptInteractions.snapshot().notes).toMatchObject([{ chat: 'c', kind: 'stuck' }]);
    }));

  it('answers a button with the block trigger of its name, whose texts are CBS over what it wrote', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, [
        { kind: 'blocks', id: 'trigger-0', name: 'open', on: 'manual', conditions: [], effects: [
          { kind: 'set', operator: 'set', name: 'door', value: { kind: 'text', text: 'open' } },
          { kind: 'add', role: 'char', value: { kind: 'text', text: 'The door is {{getvar::door}} at {{lastmessageid}}.' } },
        ] },
      ]);
      expect(await session.scriptCommands.press(chat, { trigger: 'open', id: '' }).answered).toBe(true);
      expect(await session.scriptCommands.press(chat, { trigger: 'missing', id: '' }).answered).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(messages()[1]).toMatchObject({ role: 'assistant' });
      expect(shown(messages()[1]!)).toMatchObject({ text: 'The door is open at -1.', staged: true });
    }));
});

describe("a request the bot's Lua rewrote", () => {
  it('is reported, not lost, when the worker fails to count it', () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)`);
      stubRelay(() => saying('왔구나'));
      vi.spyOn(session.store.evaluation, 'rewrite').mockRejectedValueOnce(new EvaluationFailed('crashed'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toMatchObject({ kind: 'unsent', failure: { ok: false, error: 'evaluation-unavailable' } });
    }));
});

describe("the bot scripts' machine", () => {
  it('is ended when its session closes, one still being made then too', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { accountId, vaultKey } = await server.account();
    let made!: (runner: LuaRunner) => void;
    const lua = vi.fn(() => new Promise<LuaRunner>((resolve) => (made = resolve)));
    const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, { lua });
    if (!opened.ok) throw new Error(opened.error);
    const { chat } = await chatWith(opened.data, `function open(id) end`);
    const pressed = opened.data.scriptCommands.press(chat, { trigger: 'open', id: '' }).answered;
    await vi.waitFor(() => expect(lua).toHaveBeenCalledOnce());
    opened.data.close();
    const close = vi.fn();
    made({ run: () => Promise.reject(new Error('closed')), installDisplay: () => Promise.reject(new Error('closed')), forgetDisplay() {}, display: () => Promise.reject(new Error('closed')), check: () => Promise.reject(new Error('closed')), close });
    await pressed;
    expect(close).toHaveBeenCalledOnce();
  });
});

// Lua's editDisplay stretches as the engine runs them, each held at the gate hold() set until that is let go, so the
// display shown before a pass lands can be read.
function luaDisplays() {
  const run = Lua.prototype.display;
  const display = vi.spyOn(Lua.prototype, 'display');
  const hold = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    display.mockImplementation(async function (this: Lua, ...args) {
      await held;
      return run.apply(this, args);
    });
    return release;
  };
  return { display, hold };
}

describe("the display with the bot's Lua", () => {
  it('shows each message after its editDisplay pass, with the state as of it, and again when the state changes', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `listenEdit('editDisplay', function(id, value, meta) return value .. ' <' .. meta.index .. ':' .. getChatVar(id, 'hp') .. '>' end)
        function hit(id) setChatVar(id, 'hp', '9') end`,
      );
      stubRelay(() => saying('왔구나'));
      await takeTurn(session, chat, { kind: 'send', text: '안녕' });
      const lua = luaDisplays();
      const release = lua.hold();
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening, session.display);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      expect(screen.snapshot().pending).toBe(true);
      await vi.waitFor(() => expect(screen.snapshot().display.texts).toEqual(['', '', '']));
      release();
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:null>', '안녕 <0:null>', '왔구나 <1:null>']);
      await session.scriptCommands.press(chat, { trigger: 'hit', id: '' }).answered;
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:9>', '안녕 <0:null>', '왔구나 <1:9>']);
      lua.display.mockRestore();
      leave();
    }));

  it('passes a message again when a toggle its listener reads changes', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editDisplay', function(id, value) return value .. ' <' .. getGlobalVar(id, 'toggle_hard') .. '>' end)`, [{ key: 'hard', label: '어렵게', kind: 'check', default: '0' }]);
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening, session.display);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <0>']);
      await setToggle(session.store, opening.chat.character, 'hard', '1');
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <1>']);
      leave();
    }));

  it('passes again, after reloadDisplay, the messages of a stretch that was running when it was asked', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editDisplay', function(id, value) return value end)\nfunction again(id) reloadDisplay(id) end`);
      for (let said = 0; said < 9; said++) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      const run = Lua.prototype.display;
      const passed: number[][] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      // The second stretch, of the two oldest messages, is held until reloadDisplay has been asked, and long enough
      // that the stretch after it is a short one of the newest.
      const display = vi.spyOn(Lua.prototype, 'display').mockImplementation(async function (this: Lua, owner, generation, size) {
        const shown = await run.call(this, owner, generation, size);
        if (passed.push(Array.from({ length: shown.texts.length }, (_, at) => shown.from + at - 1)) === 2) await held;
        return shown;
      });
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening, session.display);
      // As a chat screen does (useChatDisplay): a refresh while the first pass runs would make a second.
      screen.setInputs(opening, { width: 1200, height: 800 });
      const leave = screen.subscribe(() => {});
      await vi.waitFor(() => expect(passed).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [-1, 0]]));
      await session.scriptCommands.press(chat, { trigger: 'again', id: '' }).answered;
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await vi.waitFor(() => expect(passed.slice(2).flat()).toContain(-1));
      display.mockRestore();
      leave();
    }));

  it('leaves it to the engine whether a script listens: one that only names the hook is passed once, one registered under a computed name is passed', () =>
    server.withSession(async (session) => {
      const open = async (script: string | Trigger[]) => {
        const { chat, messages } = await chatWith(session, script);
        const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
        const screen = session.read.screen(chat, session.talk, session.illustrator, opening, session.display);
        screen.setInputs(opening, { width: 1200, height: 800 });
        const leave = screen.subscribe(() => {});
        return { texts: () => screen.snapshot().display.texts, again: () => screen.setInputs(opening, { width: 800, height: 800 }), leave };
      };
      const { display, hold } = luaDisplays();
      let release = hold();
      const named = await open(`-- editDisplay\nfunction onStart(id) end`);
      await vi.waitFor(() => expect(named.texts()).toEqual(['']));
      release();
      await expect.poll(named.texts).toEqual(['어서 와.']);
      named.again();
      expect(named.texts()).toEqual(['어서 와.']);
      expect(display).toHaveBeenCalledOnce();
      named.leave();

      release = hold();
      const computed = await open(`listenEdit('edit' .. 'Display', function(id, value) return value .. '!' end)`);
      await vi.waitFor(() => expect(computed.texts()).toEqual(['어서 와.']));
      release();
      await expect.poll(computed.texts).toEqual(['어서 와.!']);
      computed.leave();

      display.mockClear();
      const mixed = await open([
        { kind: 'lua', id: 'trigger-0', name: 'named', code: `-- editDisplay\nfunction onInput(id) end` },
        { kind: 'lua', id: 'trigger-1', name: 'listening', code: `listenEdit('editDisplay', function(id, value) return value .. '?' end)` },
      ]);
      await expect.poll(mixed.texts).toEqual(['어서 와.?']);
      mixed.again();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(display).toHaveBeenCalledOnce();
      mixed.leave();
      display.mockRestore();
    }));
});


// The forecast's tool slots; a chat whose memory no tool holds reads no scope for them.
const cachedTools = (session: Session, chat: string) => session.scriptTurns.cachedPrompt(chat, { scope: { messages: [] } as unknown as TurnContext['scope'], memory: null }).tools;

async function notesTool(session: Session) {
  const parsed = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@display-name 메모\n//@uses model\n//@menu now 지금 정리\n//@action redo 다시 정리\n//@composer 메모\n//@input tidy 다듬기'));
  if (!parsed.ok) throw new Error('fixture');
  const added = await importTool(session.store, session.files, parsed.tool);
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  return { parsed, added };
}

async function toolChat(session: Session) {
  await answerable(session);
  const { parsed, added } = await notesTool(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  return { chat, module: added.data.id, variable: toolVar(parsed.tool.manifest, 'summary'), messages: () => fold(session.store.children('entry', chat)) };
}

describe('tool events through Scripts', () => {
  it('adds live slot text and before writes to a turn, reuses its forecast, and never starts Lua', async () => {
    let variable = '';
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _units, _scope, event) => ({ ...noOutcome(), ...(event.kind === 'prompt' && { value: 'tool summary', writes: [[variable, '"prepared"']] as [string, string][] }) }));
    const binding = { run, close: () => {} };
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      variable = fixture.variable;
      const lua = vi.spyOn(Lua.prototype, 'run');
      const log = stubRelay(() => saying('reply'));
      expect(await takeTurn(session, fixture.chat, { kind: 'send', text: 'hello' })).toBeNull();
      await expect.poll(() => fixture.messages().length).toBe(2);
      expect(shown(fixture.messages()[1]!).before).toEqual([[variable, '"prepared"']]);
      expect(log[0]!.sent.body).toContain('tool summary');
      expect(session.log.entry(fixture.chat, shown(fixture.messages()[1]!).receipt!.id)!.prompt!.parts).toContainEqual(expect.objectContaining({ from: { kind: 'tool', name: '메모' } }));
      const prompts = () => run.mock.calls.filter((args) => args[3].kind === 'prompt').length;
      expect(prompts()).toBe(1);
      expect((await wouldSend(session, fixture.chat, { kind: 'answer' }))!.prompt.messages.some(({ content }) => content === 'tool summary')).toBe(true);
      expect(prompts()).toBe(1);
      expect(lua).not.toHaveBeenCalled();
    }, binding);
  });

  it('anchors a delayed reply write to its saved version across regeneration', async () => {
    let finish!: (outcome: ScriptOutcome) => void;
    let replies = 0;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, _scope, event) => {
      if (event.kind === 'reply' && replies++ === 0) return new Promise<ScriptOutcome>((resolve) => { finish = resolve; });
      return noOutcome();
    }, close: () => {} };
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      stubRelay(() => saying('reply'));
      await takeTurn(session, fixture.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => replies).toBe(1);
      const original = shown(fixture.messages()[1]!).id;
      await takeTurn(session, fixture.chat, { kind: 'regenerate', message: fixture.messages()[1]!.id });
      await expect.poll(() => fixture.messages()[1]!.versions.length).toBe(2);
      finish({ ...noOutcome(), writes: [[fixture.variable, '"old summary"']] });
      await expect.poll(() => session.store.children('entry', fixture.chat).some(({ value }) => value.type === 'vars' && value.version === original)).toBe(true);
      expect(shown(fixture.messages()[1]!).after ?? []).toEqual([]);
      await selectVersion(session.store, fixture.chat, fixture.messages()[1]!.id, original);
      expect(shown(fixture.messages()[1]!).after).toEqual([[fixture.variable, '"old summary"']]);
    }, binding);
  });

  it('keeps a queued reply snapshot and anchor when another version is shown before the job starts', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const heard: { version: string; snapshot: string }[] = [];
    let variable = '';
    let menuStarted = false;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, scope, event) => {
      if (event.kind === 'menu') { menuStarted = true; await held; }
      if (event.kind !== 'reply') return noOutcome();
      heard.push({ version: event.reply.version, snapshot: scope.messages.at(-1)!.id });
      if (heard.length !== 1) return noOutcome();
      return {
        ...noOutcome(), writes: [[variable, '"original"']],
        edits: [{ index: event.reply.index, text: 'old edit', wrote: [] }],
        added: [{ role: 'char', text: 'old addition', before: null }],
        tool: { data: [['heard', event.reply.version]], badges: [{ index: event.reply.index, text: 'old badge' }] },
      };
    }, close: () => { release(); } };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      variable = f.variable;
      const menu = session.scriptCommands.menu(f.chat, f.module, 'now');
      await expect.poll(() => menuStarted).toBe(true);
      stubRelay(inTurn([saying('original'), saying('replacement')]));
      await takeTurn(session, f.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => f.messages().length).toBe(2);
      const original = shown(f.messages()[1]!).id;
      await takeTurn(session, f.chat, { kind: 'regenerate', message: f.messages()[1]!.id });
      await expect.poll(() => f.messages()[1]!.versions.length).toBe(2);
      const replacement = shown(f.messages()[1]!).id;
      expect(heard).toEqual([]);
      release();
      await menu;
      // A later lane job is a barrier for both reply applications, not just their bindings.
      await session.scriptCommands.menu(f.chat, f.module, 'now');
      expect(heard).toEqual([{ version: original, snapshot: original }, { version: replacement, snapshot: replacement }]);
      expect(f.messages()).toHaveLength(2);
      expect(shown(f.messages()[1]!)).toMatchObject({ id: replacement, text: 'replacement' });
      expect(shown(f.messages()[1]!).after ?? []).toEqual([]);
      expect(toolBadges(session.store, f.module, f.chat)).toEqual({});
      expect(toolChatData(session.store, f.module, f.chat, 'heard')).toBe(original);
      await selectVersion(session.store, f.chat, f.messages()[1]!.id, original);
      expect(shown(f.messages()[1]!)).toMatchObject({ text: 'original', after: [[variable, '"original"']] });
    }, binding);
  });

  it.each([false, true])('guards delayed reply edits and adds when the story advances: %s', async (advance) => {
    let finish!: (outcome: ScriptOutcome) => void;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, _scope, event) => event.kind === 'reply' ? new Promise((resolve) => { finish = resolve; }) : noOutcome(), close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      stubRelay(() => saying('reply'));
      await takeTurn(session, f.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => finish).toBeDefined();
      if (advance) await appendUserMessage(session.store, f.chat, { id: crypto.randomUUID(), text: 'newer' });
      finish({ ...noOutcome(), writes: [[f.variable, '"saved"']], edits: [{ index: 0, text: 'changed user', wrote: [] }, { index: 1, text: 'changed reply', wrote: [] }], added: [{ role: 'char', text: 'added', before: null }] });
      await expect.poll(() => shown(f.messages()[1]!).text).toBe('changed reply');
      expect(shown(f.messages()[0]!).text).toBe(advance ? 'hello' : 'changed user');
      expect(shown(f.messages().at(-1)!).text).toBe(advance ? 'newer' : 'added');
      expect(session.store.children('entry', f.chat).some(({ value }) => value.type === 'vars' && value.set.some(([key]) => key === f.variable))).toBe(true);
      expect(session.scriptInteractions.snapshot().notes.filter(({ kind }) => kind === 'stale-reply')).toHaveLength(advance ? 1 : 0);
    }, binding);
  });

  it('runs a change after the pending reply on the tool lane, keeps its data and badges, and never holds a send behind an action', async () => {
    const heard: string[] = [];
    let finishReply!: (outcome: ScriptOutcome) => void;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, _scope, event) => {
      heard.push(event.kind === 'change' ? `change:${event.change.kind}:${event.change.index}` : event.kind);
      if (event.kind === 'reply' && heard.filter((kind) => kind === 'reply').length === 1) return new Promise((resolve) => { finishReply = resolve; });
      if (event.kind === 'action') return new Promise(() => {});
      if (event.kind === 'change') return { ...noOutcome(), tool: { data: [['index', { stale: event.change.id }]], badges: [{ index: event.change.index, text: '고침' }] } };
      return noOutcome();
    }, close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      stubRelay(() => saying('reply'));
      await takeTurn(session, f.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => heard).toContain('reply');
      const said = f.messages()[0]!;
      expect((await editShown(session, f.chat, said, 'hello again', null)).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(heard.filter((kind) => kind.startsWith('change'))).toEqual([]);
      finishReply(noOutcome());
      await expect.poll(() => toolChatData(session.store, f.module, f.chat, 'index')).toEqual({ stale: said.id });
      expect(heard).toEqual(['sending', 'prompt', 'requesting', 'replying', 'reply', 'change:edit:0']);
      expect(toolBadges(session.store, f.module, f.chat)).toEqual({ [said.id]: { version: shown(f.messages()[0]!).id, text: '고침' } });

      void session.scriptCommands.action(f.chat, f.module, 'redo', said.id);
      await expect.poll(() => heard).toContain('action');
      expect(await takeTurn(session, f.chat, { kind: 'send', text: 'not held' })).toBeNull();
      await expect.poll(() => f.messages().length).toBe(4);
    }, binding);
  });

  it('hands an input item the draft and returns the text it answers, none for an undeclared item or a stopped run', async () => {
    let hold: Promise<void> = Promise.resolve();
    const binding: Binding<ToolUnit, ToolEvent> = { run: async (_chat, _units, _scope, event) => {
      if (event.kind !== 'input') return noOutcome();
      await hold;
      return { ...noOutcome(), handled: true, value: `${event.text} [${event.item}]` };
    }, close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      expect(await session.scriptCommands.input(f.chat, f.module, 'tidy', 'hello', new AbortController().signal)).toBe('hello [tidy]');
      expect(await session.scriptCommands.input(f.chat, f.module, 'other', 'hello', new AbortController().signal)).toBeNull();
      let release!: () => void;
      hold = new Promise((resolve) => { release = resolve; });
      const stop = new AbortController();
      const stopped = session.scriptCommands.input(f.chat, f.module, 'tidy', 'hello', stop.signal);
      stop.abort();
      release();
      expect(await stopped).toBeNull();
    }, binding);
  });

  it('gives the memory slot to the first tool allowed to claim it, keeps its card past a run, maps its through, and keeps its memory past a missed deadline', async () => {
    const heard: { module: string; memory: boolean }[] = [];
    let mode: 'before-last' | 'last' | 'late' = 'before-last';
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, unit, scope, event) => {
      if (event.kind !== 'prompt') return noOutcome();
      heard.push({ module: unit.module, memory: event.turn.memory });
      if (mode === 'late' && event.turn.memory) return new Promise(() => {});
      const through = scope.messages.at(mode === 'last' ? -1 : -2)!.message;
      return { ...noOutcome(), value: { memory: { text: `remembered ${unit.tool.manifest.name}`, through }, tool: `recall ${unit.tool.manifest.name}` } };
    });
    await server.withSession(async (session) => {
      await answerable(session);
      const modules: string[] = [];
      for (const name of ['first', 'second']) {
        const parsed = readTool(new TextEncoder().encode(`//@api 1\n//@name ${name}\n//@author jin\n//@uses memory`));
        if (!parsed.ok) throw new Error('fixture');
        const added = await importTool(session.store, session.files, parsed.tool);
        if (!added.ok) throw new Error(added.error);
        await setModuleAlways(session.store, added.data.id, true);
        modules.push(added.data.id);
      }
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      for (const text of ['one', 'two', 'three']) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text });
      session.scriptInteractions.claims(chat);
      session.scriptInteractions.claims(chat);
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toHaveLength(2);
      expect(session.scriptInteractions.snapshot().questions.map(({ question }) => question.kind)).toEqual(['plugin', 'plugin']);
      await session.scriptPages.pageWrite(chat, modules[0]!, noOutcome());
      expect(session.scriptInteractions.snapshot().questions).toHaveLength(2);
      for (const { id } of session.scriptInteractions.snapshot().questions) session.scriptInteractions.answer(id, 'yes');
      await expect.poll(() => modules.map((module) => session.store.get('module', module)!.value.takesMemory)).toEqual([true, true]);
      await session.store.projections.evaluate(chat);
      const gather = () => gatherTurn(session, chat, { kind: 'answer' });
      const turn = gather();
      if (!turn || 'kind' in turn) throw new Error('fixture');
      expect(turn.memory).toEqual({ kind: 'tool', name: 'first', text: '', through: -1 });
      const prompted = async () => {
        const result = await session.scriptTurns.prompting(chat, turn, async () => gather(), new AbortController().signal);
        if ('kind' in result) throw new Error(result.kind);
        return result;
      };

      const first = await prompted();
      expect(heard).toEqual([{ module: modules[0], memory: true }, { module: modules[1], memory: false }]);
      expect(first.turn.memory).toEqual({ kind: 'tool', name: 'first', text: 'remembered first', through: 1 });
      expect(first.tools.map(({ text }) => text)).toEqual(['recall first', 'recall second']);
      await prompted();
      expect(session.scriptInteractions.snapshot().notes.filter(({ kind }) => kind === 'memory-held')).toMatchObject([{ by: 'first', from: { id: modules[1] } }]);

      mode = 'last';
      expect((await prompted()).turn.memory).toMatchObject({ text: 'remembered first', through: -1 });
      expect(session.scriptInteractions.snapshot().notes).toContainEqual(expect.objectContaining({ kind: 'failed', from: { kind: 'module', id: modules[0] } }));

      mode = 'before-last';
      await prompted();
      mode = 'late';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const missed = prompted();
        await vi.advanceTimersByTimeAsync(5001);
        const result = await missed;
        expect(result.turn.memory).toEqual({ kind: 'tool', name: 'first', text: 'remembered first', through: 1 });
        expect(result.tools.map(({ text }) => text)).toEqual(['recall second']);
      } finally { vi.useRealTimers(); }
      expect(session.scriptTurns.cachedPrompt(chat, turn).memory).toMatchObject({ text: 'remembered first', through: 1 });
    }, { run, close: () => {} });
  });

  it('answers an unasked consent with no card under a tool deadline, asks from a menu press, and tells a missing 임베딩 모델 once', async () => {
    const answers: unknown[] = [];
    const binding: Binding<ToolUnit> = { run: async (_chat, unit, _scope, event, host) => {
      if (event.kind === 'prompt' || event.kind === 'menu') {
        answers.push(await host.embed(['query'], 'query', { kind: 'module', id: unit.module }));
        if (event.kind === 'prompt') answers.push(await host.model('aux', [{ role: 'user', content: 'x' }], { kind: 'module', id: unit.module }));
      }
      return noOutcome();
    }, close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      await appendUserMessage(session.store, f.chat, { id: crypto.randomUUID(), text: 'hello' });
      await session.store.projections.evaluate(f.chat);
      const turn = gatherTurn(session, f.chat, { kind: 'answer' });
      if (!turn || 'kind' in turn) throw new Error('fixture');
      await session.scriptTurns.prompting(f.chat, turn, async () => turn, new AbortController().signal);
      expect(answers).toEqual([{ ok: false, reason: 'not-allowed' }, expect.objectContaining({ success: false, reason: 'not-allowed' })]);
      expect(session.scriptInteractions.snapshot().questions).toEqual([]);
      const pressed = session.scriptCommands.menu(f.chat, f.module, 'now');
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toMatchObject([{ question: { kind: 'plugin', grants: ['model'] } }]);
      session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      await pressed;
      await session.scriptCommands.menu(f.chat, f.module, 'now');
      expect(answers.slice(2)).toEqual([{ ok: false, reason: 'no-model' }, { ok: false, reason: 'no-model' }]);
      expect(session.scriptInteractions.snapshot().notes.filter(({ kind }) => kind === 'no-model')).toMatchObject([{ role: 'embed' }]);
    }, binding);
  });

  it('forgets forecast text when a tool leaves or a chat unloads', async () => {
    const binding: Binding<ToolUnit> = { run: async () => ({ ...noOutcome(), value: 'cached' }), close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      const chat = crypto.randomUUID();
      let lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
      const cache = async () => {
        await session.store.projections.evaluate(chat);
        const gather = () => gatherTurn(session, chat, { kind: 'answer' });
        const turn = gather();
        if (!turn || 'kind' in turn) throw new Error('fixture');
        await session.scriptTurns.prompting(chat, turn, async () => gather(), new AbortController().signal);
        expect(cachedTools(session, chat)).toHaveLength(1);
      };
      try {
        await cache();
        await setModuleAlways(session.store, f.module, false);
        await setModuleAlways(session.store, f.module, true);
        expect(cachedTools(session, chat)).toEqual([]);
        await cache();
        lease.release();
        await expect.poll(() => session.store.scopeState(chat)).toBe('unloaded');
        lease = session.store.retainChat(chat);
        await lease.ready;
        expect(cachedTools(session, chat)).toEqual([]);
      } finally { lease.release(); }
    }, binding);
  });

  it('hands a reply to each tool after the bot Lua, and passes it on unchanged past a tool that misses the deadline', async () => {
    const late: (() => void)[] = [];
    let hang = false;
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _unit, _scope, event) => {
      if (event.kind !== 'replying') return noOutcome();
      if (hang) return new Promise((resolve) => late.push(() => resolve({ ...noOutcome(), value: 'too late' })));
      return { ...noOutcome(), handled: true, value: `${event.text} [tool]` };
    });
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      const lua = await importModule(session.store, session.files, { name: 'lua', description: '', namespace: null, risu: null, pack: { regex: [], toggles: [], triggers: [{ kind: 'lua', id: 'lua', name: 'edit', code: "listenEdit('editOutput', function(id, value) return value .. ' [lua]' end)" }] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
      if (!lua.ok) throw new Error(lua.error);
      await setModuleAlways(session.store, lua.data.id, true);
      stubRelay(() => saying('reply'));
      await takeTurn(session, f.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => f.messages().length).toBe(2);
      expect(shown(f.messages()[1]!).text).toBe('reply [lua] [tool]');
      hang = true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const reply: Written = { id: crypto.randomUUID(), message: null, replaces: null, at: Date.now(), text: 'again', receipt: { state: 'done' } as Written['receipt'] };
        const ending = session.scriptTurns.ending(f.chat, reply);
        await vi.waitFor(() => expect(late).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(5001);
        expect((await ending).text).toBe('again [lua]');
        expect(session.scriptInteractions.snapshot().notes).toContainEqual(expect.objectContaining({ kind: 'late', from: { kind: 'module', id: f.module } }));
      } finally { vi.useRealTimers(); for (const resolve of late) resolve(); }
    }, { run, close: () => {} });
  });

  it('hands the message sent and the request to each tool after the bot Lua, a chat message keeping its id', async () => {
    const seen: Hazelle.RequestMessage[][] = [];
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _unit, _scope, event) => {
      if (event.kind === 'sending') return { ...noOutcome(), handled: true, value: `${event.text} [tool]` };
      if (event.kind !== 'requesting') return noOutcome();
      seen.push(event.messages);
      return { ...noOutcome(), handled: true, value: [...event.messages, { role: 'system', content: 'from tool' }] };
    });
    await server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editInput', function(id, value) return value .. ' [lua]' end)
        listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)`);
      await notesTool(session);
      const log = stubRelay(() => saying('응'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => log.length).toBe(1);
      const said = messages()[1]!;
      expect(shown(said).text).toBe('안녕 [lua] [tool]');
      expect(seen[0]!.find(({ content }) => content === '안녕 [lua] [tool]')).toMatchObject({ role: 'user', message: said.id });
      const sent = (JSON.parse(log[0]!.sent.body!) as { messages: { content: string }[] }).messages;
      expect(sent.slice(-2).map(({ content }) => content)).toEqual(['from lua', 'from tool']);
    }, { run, close: () => {} });
  });

  it('waits for a tool reading the request past the tool deadline, naming it, until 멈추기 ends the wait', async () => {
    const late: ((value: unknown[]) => void)[] = [];
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _unit, _scope, event) => event.kind !== 'requesting' ? noOutcome() : new Promise((resolve) => late.push((value) => resolve({ ...noOutcome(), value }))));
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      await appendUserMessage(session.store, f.chat, { id: crypto.randomUUID(), text: 'hello' });
      await session.store.projections.evaluate(f.chat);
      const turn = gatherTurn(session, f.chat, { kind: 'answer' });
      if (!turn || 'kind' in turn) throw new Error('fixture');
      const prompt = { messages: [{ role: 'user' as const, content: 'hello' }], parts: [{ from: { kind: 'script' as const }, tokens: 1, origin: 'message' }] };
      const running: string[] = [];
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const requesting = session.scriptTurns.requesting(f.chat, turn, prompt, new AbortController().signal, (name) => running.push(name));
        await vi.waitFor(() => expect(late).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(5001);
        late[0]!([{ role: 'user', content: 'hello, noted' }]);
        expect((await requesting).messages).toEqual([{ role: 'user', content: 'hello, noted' }]);
        expect(running).toEqual(['메모']);
        const stop = new AbortController();
        const stopped = session.scriptTurns.requesting(f.chat, turn, prompt, stop.signal, () => {});
        await vi.waitFor(() => expect(late).toHaveLength(2));
        stop.abort();
        expect((await stopped).messages).toEqual(prompt.messages);
      } finally { vi.useRealTimers(); for (const resolve of late) resolve([]); }
    }, { run, close: () => {} });
  });

  it('shows each message after the bot Lua and then the tools, which see where it stands', async () => {
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _unit, _scope, event) => event.kind !== 'showing' ? noOutcome()
      : { ...noOutcome(), handled: true, value: event.shown.map(({ at, text }) => `${text} [${at ? at.index : 'greeting'}]`) });
    await server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editDisplay', function(id, value) return value .. ' [lua]' end)`);
      await notesTool(session);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening, session.display);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. [lua] [greeting]', '안녕 [lua] [0]']);
      leave();
    }, { run, close: () => {} });
  });

  it('skips a prompt after its deadline, drops late writes, and notes that tool only once', async () => {
    const finish: ((outcome: ScriptOutcome) => void)[] = [];
    const run = vi.fn<Binding<ToolUnit>['run']>(() => new Promise((resolve) => finish.push(resolve))).mockResolvedValueOnce({ ...noOutcome(), value: 'previous summary' });
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      await appendUserMessage(session.store, fixture.chat, { id: crypto.randomUUID(), text: 'hello' });
      await session.store.projections.evaluate(fixture.chat);
      const gather = () => gatherTurn(session, fixture.chat, { kind: 'answer' });
      const turn = gather();
      if (!turn || 'kind' in turn) throw new Error('fixture');
      await session.scriptTurns.prompting(fixture.chat, turn, async () => gather(), new AbortController().signal);
      expect(cachedTools(session, fixture.chat)).toHaveLength(1);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const prompt = session.scriptTurns.prompting(fixture.chat, turn, async () => gather(), new AbortController().signal);
          await vi.advanceTimersByTimeAsync(0);
          expect(run).toHaveBeenCalledTimes(attempt + 2);
          await vi.advanceTimersByTimeAsync(5001);
          expect(await prompt).toMatchObject({ tools: [], turn: { reply: { before: [] } } });
          expect(cachedTools(session, fixture.chat)).toEqual([]);
          finish[attempt]!({ ...noOutcome(), value: 'too late', writes: [[fixture.variable, 'late']] });
        }
        expect(session.scriptInteractions.snapshot().notes.filter(({ kind }) => kind === 'late')).toMatchObject([{ from: { kind: 'module', id: fixture.module } }]);
        expect(session.store.children('entry', fixture.chat).filter(({ value }) => value.type === 'vars')).toEqual([]);
      } finally { vi.useRealTimers(); for (const resolve of finish) resolve(noOutcome()); }
    }, { run, close: () => {} });
  });

  it('dismisses an aborted prompt question, drops its late result, and lets the next prompt run', async () => {
    let finish!: (outcome: ScriptOutcome) => void;
    let answer: string | null | undefined;
    let prompts = 0;
    const binding: Binding<ToolUnit> = { run: async (_chat, unit, _scope, event, host) => {
      if (event.kind !== 'prompt') return noOutcome();
      if (prompts++ > 0) return { ...noOutcome(), value: 'next' };
      const late = new Promise<ScriptOutcome>((resolve) => { finish = resolve; });
      answer = await host.ask({ kind: 'input', text: 'Continue?' }, { kind: 'module', id: unit.module });
      return late;
    }, close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      await appendUserMessage(session.store, f.chat, { id: crypto.randomUUID(), text: 'hello' });
      await session.store.projections.evaluate(f.chat);
      const turn = gatherTurn(session, f.chat, { kind: 'answer' });
      if (!turn || 'kind' in turn) throw new Error('fixture');
      const stop = new AbortController();
      const pending = session.scriptTurns.prompting(f.chat, turn, async () => turn, stop.signal);
      await expect.poll(() => session.scriptInteractions.snapshot().questions).toHaveLength(1);
      stop.abort();
      expect(await pending).toMatchObject({ tools: [], turn: { reply: { before: [] } } });
      expect(answer).toBeNull();
      expect(session.scriptInteractions.snapshot()).toEqual({ notes: [], questions: [] });
      finish({ ...noOutcome(), value: 'late', writes: [[f.variable, '"late"']], added: [{ role: 'char', text: 'late', before: null }] });
      expect(await session.scriptTurns.prompting(f.chat, turn, async () => turn, new AbortController().signal)).toMatchObject({ tools: [{ text: 'next' }] });
      expect(cachedTools(session, f.chat)).toMatchObject([{ text: 'next' }]);
      expect(f.messages()).toHaveLength(1);
      expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toEqual([]);
    }, binding);
  });

  it('asks module Lua on its own behalf even with no character, and remembers it in another chat', () => server.withSession(async (session) => {
    await answerable(session);
    const added = await importModule(session.store, session.files, { name: 'module', description: '', namespace: null, risu: null, pack: { regex: [], toggles: [], triggers: [{ kind: 'lua', id: 'lua', name: 'model', code: 'askModel = async(function(id) LLM(id, {{role="user", content="summarize"}}) end)' }] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
    if (!added.ok) throw new Error(added.error);
    await setModuleAlways(session.store, added.data.id, true);
    const log = stubRelay(() => saying('summary'));
    for (let index = 0; index < 2; index++) {
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
      const pressed = session.scriptCommands.press(chat, { trigger: 'askModel', id: '' }).answered;
      if (!index) {
        await expect.poll(() => session.scriptInteractions.snapshot().questions).toMatchObject([{ from: { kind: 'module', id: added.data.id }, question: { kind: 'model' } }]);
        session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
      }
      await pressed;
      expect(session.store.get('module', added.data.id)!.value.botModels).toBe(true);
      expect(session.scriptInteractions.snapshot().questions).toEqual([]);
    }
    expect(log).toHaveLength(2);
  }));
});

it('keeps bounded per-chat hook logs with Lua output and writes, notifies readers, and forgets unloaded scopes', () => server.withSession(async (session) => {
  const card = blankCard('logger');
  card.triggers = [{ id: 'log', kind: 'lua', name: 'logger', code: `function onButtonClick(id, data)
    log({ message = data })
    setChatVar(id, 'last', data)
    request(id, 'unsupported')
    if data == 'flood' then for i = 1, 20 do log(string.rep('x', 1100)) end end
    return false
  end` }];
  const character = await session.store.create('character', { card, folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  const lease = session.store.retainChat(chat);
  await lease.ready;
  const notify = vi.fn();
  const stop = session.scriptJournal.subscribeLog(chat, notify);
  try {
    await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, null);
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
    expect(await session.scriptCommands.press(chat, { data: 'awake' }).answered).toBe(true);
    expect(session.scriptJournal.log(chat).entries).toHaveLength(1);
    const entry = session.scriptJournal.log(chat).entries[0]!;
    expect(entry).toMatchObject({ stage: 'button', pack: { kind: 'character', id: character.data.id }, script: 'logger', writes: [['last', 'awake']], missing: ['request'], stopped: true, changed: false, errors: [] });
    expect(entry.logs.map((line) => JSON.parse(line))).toEqual([{ message: 'awake' }]);
    expect(entry.duration).toBeGreaterThanOrEqual(0);
    expect(notify).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 20; n++) await session.scriptCommands.press(chat, { data: 'flood' }).answered;
    const log = session.scriptJournal.log(chat);
    expect(log.entries.length).toBeLessThanOrEqual(SCRIPT_LOG_LIMITS.entries);
    expect(log.entries.reduce((size, each) => size + JSON.stringify(each).length, 0)).toBeLessThanOrEqual(SCRIPT_LOG_LIMITS.characters);
    expect(log.omitted).toBeGreaterThan(0);
    expect(log.entries.at(-1)!.truncated).toBe(true);
    lease.release();
    await expect.poll(() => session.store.scopeState(chat)).toBe('unloaded');
    expect(session.scriptJournal.log(chat)).toEqual({ entries: [], omitted: 0 });
  } finally { stop(); lease.release(); }
}));

describe('a trial of one trigger', () => {
  it('runs the draft alone for the event on the chat as it stands, saving nothing and calling no model', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function onOutput(id) setChatVar(id, 'stored', '1') end`);
      const scope = (await chatNow(session, chat, new AbortController().signal))!;
      const draft = {
        kind: 'lua' as const,
        id: 'trigger-0',
        name: 'main',
        owner: { kind: 'character' as const, id: session.store.get('chat', chat)!.value.character! },
        code: `onOutput = async(function(id)
          setChatVar(id, 'last', getCharacterLastMessage(id))
          alertNormal(id, 'hi')
          LLM(id, { { role = 'user', content = 'hi' } })
        end)`,
      };
      const trial = await session.scriptPreview.trial(chat, scope, draft, { kind: 'output' }, new AbortController().signal);
      expect(trial.outcome.writes).toEqual([['last', '어서 와.']]);
      expect(trial).toMatchObject({ said: [{ tone: 'normal', text: 'hi' }], calls: { model: 1, embed: 0, background: 0 } });
      expect(messages()).toHaveLength(1);
      expect(session.scriptJournal.log(chat).entries).toEqual([]);
    }));
});

describe('a rehearsal of the pre-send scripts', () => {
  it('saves nothing and keeps no page log, handing back what each stage did and the request as it would be', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'order', 'input') end
        listenEdit('editInput', function(id, value) return value .. ' [' .. getChatVar(id, 'order') .. ']' end)
        function onStart(id)
          setChatVar(id, 'turn', getChat(id, -1).data)
          addChat(id, 'char', 'narration')
          upsertLocalLoreBook(id, 'Gate', 'the gate is shut', { alwaysActive = true })
        end
        listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)`,
      );
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '안녕' }, undefined, 'view'))!;
      const entries = session.store.children('entry', chat).length;
      const rehearsal = (await session.scriptPreview.rehearse(chat, sending, new AbortController().signal))!;
      expect(session.store.children('entry', chat)).toHaveLength(entries);
      expect(session.store.children('lore', chat)).toEqual([]);
      expect(messages()).toHaveLength(1);
      expect(session.scriptJournal.log(chat).entries).toEqual([]);
      expect(rehearsal.trace.entries.map(({ stage }) => stage)).toEqual(['onInput', 'editInput', 'onStart', 'editRequest']);
      expect(rehearsal).toMatchObject({ stopped: null, input: '안녕 [input]', changed: true });
      expect(rehearsal.scope.messages.slice(-2).map(({ text, before }) => [text, before])).toEqual([['안녕 [input]', [['order', 'input']]], ['narration', undefined]]);
      expect(rehearsal.scope.pending).toEqual([['turn', '안녕 [input]']]);
      expect(rehearsal.scope.lore.map(({ parent, value }) => [parent, value.name])).toContainEqual([chat, 'Gate']);
      const after = rehearsal.prompt!;
      if ('kind' in after) throw new Error(after.kind);
      expect(JSON.stringify(after.messages)).toContain('narration');
      expect(JSON.stringify(after.messages)).toContain('the gate is shut');
      expect(rehearsal.request!.at(-1)).toEqual({ role: 'system', content: 'from lua' });
    }));

  it('calls no model, answering the script with a refusal and counting the call', () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `onStart = async(function(id) setChatVar(id, 'answer', LLM(id, { { role = 'user', content = 'hi' } }).result) end)`);
      const log = stubRelay(() => saying('never'));
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '안녕' }, undefined, 'view'))!;
      const rehearsal = (await session.scriptPreview.rehearse(chat, sending, new AbortController().signal))!;
      expect(log).toHaveLength(0);
      expect(rehearsal.calls).toEqual({ model: 1, embed: 0, background: 0 });
      expect(rehearsal.scope.pending).toEqual([['answer', NOT_REHEARSED]]);
    }));

  it("says a script's lorebook read ran away", () =>
    server.withSession(async (session) => {
      const doubling = "'{{settempvar::x::abcdefghijklmnop}}' .. string.rep('{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}', 22)";
      const { chat } = await chatWith(
        session,
        `function onInput(id) upsertLocalLoreBook(id, 'Grow', ${doubling}, { alwaysActive = true }) end
        function onStart(id) loadLoreBooks(id) end`,
      );
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '안녕' }, undefined, 'view'))!;
      const rehearsal = (await session.scriptPreview.rehearse(chat, sending, new AbortController().signal))!;
      expect(rehearsal.loreRanAway).toBe(true);
    }));

  it('builds the request with memory over the messages onStart added', () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `function onStart(id) addChat(id, 'char', 'narration') end`);
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '안녕' }, undefined, 'view'))!;
      expect(sending.turn.memory?.kind).toBe('built-in');
      const prompt = vi.spyOn(session.store.evaluation, 'prompt');
      const rehearsal = (await session.scriptPreview.rehearse(chat, sending, new AbortController().signal))!;
      const memory = prompt.mock.lastCall![1].memory;
      if (memory?.kind !== 'built-in') throw new Error(memory?.kind);
      expect(memory.shown.map(({ message }) => message)).toEqual(rehearsal.scope.messages.map(({ message }) => message));
      expect(rehearsal.scope.messages.at(-1)!.text).toBe('narration');
    }));

  it("keeps editRequest's writes pending after onStart's", () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(
        session,
        `function onStart(id) setChatVar(id, 'turn', 'start') end
        listenEdit('editRequest', function(id, value) setChatVar(id, 'request', 'seen') return value end)`,
      );
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '안녕' }, undefined, 'view'))!;
      const rehearsal = (await session.scriptPreview.rehearse(chat, sending, new AbortController().signal))!;
      expect(rehearsal.scope.pending).toEqual([['turn', 'start'], ['request', 'seen']]);
    }));
});
