import * as attachments from './attachments';
import { readTool } from '../engine/import/tool';
import type { ToolUnit } from '../model/tool';
import { setModuleAlways } from './modules';
import { noOutcome, type Binding } from './script-binding';
import { importTool } from './tools/store';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import { fold, shown, type Receipt } from '../model/chat';
import { setDefaultModel, taskModel } from './assignment';
import { setTranslate } from './characters';
import { appendUserMessage, removeChat, startChat, type Written } from './chat-log';
import { projectGreetings } from './greetings';
import type { EvaluationDown } from './evaluation-core';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import type { Shown } from './talk';
import { autoContinue, takeTurn } from './turn';
import { chatScripts, statusBoxes, statusPlaces } from './chat-context';
import { blocked, wouldSend } from './turn-context';

const server = testServer();

const cutAt = (text: string, cost: number) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5, cost } })}\n\ndata: [DONE]\n\n`, {
    headers: { 'x-relay': 'upstream' },
  });
const lastTwo = (body: string | null) => (JSON.parse(body!) as { messages: { role: string; content: string }[] }).messages.slice(-2);

async function cutReply(session: Session, answers: (Response | null)[]) {
  await answerable(session);
  const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '이야기 하나 해 줘' });
  const log = stubRelay(inTurn([cutAt('옛날 옛적에', 0.002), ...answers]));
  await takeTurn(session, chat, { kind: 'answer' });
  const reply = () => fold(session.store.children('entry', chat))[1]!;
  return { chat, log, reply, cut: shown(reply()) };
}

const luna: Card = {
  name: '루나',
  nickname: null,
  description: '',
  personality: '',
  scenario: '',
  greetings: ['어서 와, {{user}}.', '또 왔네, {{char}}야.'],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [],
  toggles: [],
  utility: false,
  bias: [],
  regex: [],
  triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};

it('stops a chat with no character on a missing prompt only once it sends one', () =>
  server.withSession(async (session) => {
    await answerable(session);
    const chat = { title: null, character: null, models: {}, prompt: crypto.randomUUID() };
    expect(blocked(session, chat)).toBeNull();
    expect(blocked(session, { ...chat, sendsPrompt: true })).toEqual({ kind: 'prompt-missing', own: true });
  }));

it('keeps a chat\'s forecast history, so a second forecast sends the worker only what changed', () =>
  server.withSession(async (session) => {
    await answerable(session);
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
    const posted = vi.spyOn(Worker.prototype, 'postMessage');
    expect(await wouldSend(session, chat, { kind: 'send', text: 'one' })).not.toBeNull();
    expect(await wouldSend(session, chat, { kind: 'send', text: 'two' })).not.toBeNull();
    const forecasts = posted.mock.calls.map(([message]) => message as EvaluationDown).flatMap((message) => ('input' in message && 'history' in message.input && message.input.lane === `forecast:${chat}` ? [message.input.history] : []));
    expect(forecasts).toHaveLength(2);
    expect(forecasts[0]!.from).toBe(0);
    expect(forecasts[1]!.from).toBe(1);
    posted.mockRestore();
  }));

it('evaluates a draft forecast once more when a dependency changes before worker completion', () =>
  server.withSession(async (session) => {
    await answerable(session);
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
    const prompt = session.store.evaluation.prompt.bind(session.store.evaluation);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let started = false;
    const spy = vi.spyOn(session.store.evaluation, 'prompt').mockImplementationOnce(async (...args) => {
      const result = await prompt(...args);
      started = true;
      await gate;
      return result;
    });
    const forecast = wouldSend(session, chat, { kind: 'send', text: 'draft' });
    await vi.waitFor(() => expect(started).toBe(true));
    await session.store.update('chat', chat, (value) => ({ ...value, note: 'changed while evaluating' }));
    finish();
    expect((await forecast)?.turn.chat.note).toBe('changed while evaluating');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  }));

describe('a new chat', () => {
  it('shows the message at once, then is saved as the chat behind its greetings as written with the shown one selected, then the first message; names are filled where shown and sent', () =>
    server.withSession(async (session) => {
      const { store } = session;
      await answerable(session);
      const character = await store.create('character', { card: luna, folder: null, loreFolders: [] });
      const log = stubRelay(() => saying('왔구나.'));

      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      let preview: string | undefined;
      const greetings = projectGreetings(luna.greetings, [crypto.randomUUID(), crypto.randomUUID()], 0)!;
      const saving = startChat(store, chat, { title: null, character: character.ok ? character.data.id : null, models: {} }, greetings).then((unstarted) => {
        preview = session.read.chat(chat).snapshot()?.preview;
        return unstarted;
      });
      const turn = takeTurn(session, chat, { kind: 'send', text: '안녕' }, { greeting: greetings.choices[0]!.id, saved: saving });
      expect(session.talk.snapshot(chat)).toMatchObject({ chat, said: { text: '안녕' } });
      expect(store.get('chat', chat)).toBeNull();
      expect(await turn).toBeNull();
      expect(preview).toBe('어서 와, jin.');

      const entries = store.children('entry', chat).sort((a, b) => a.rev - b.rev);
      const saved = store.get('chat', chat)!.rev;
      expect(entries.map(({ rev }) => rev > saved)).toEqual([false, false, false, true, true]);
      expect(entries.map(({ value }) => (value.type === 'message' || value.type === 'version' ? [value.type, value.text] : [value.type]))).toEqual([
        ['message', '어서 와, {{user}}.'],
        ['version', '또 왔네, {{char}}야.'],
        ['select'],
        ['message', '안녕'],
        ['message', '왔구나.'],
      ]);
      const sent = JSON.parse(log[0]!.sent.body!) as { messages: { role: string; content: string }[] };
      // The starter prompt the session seeds: its texts, with the empty slots and notes left out, then the chat.
      expect(sent.messages.map(({ role }) => role)).toEqual(['system', 'system', 'system', 'system', 'system', 'assistant', 'user']);
      expect(sent.messages[4]!.content).toMatch(/^# Premise\nYou write 루나\. Your partner writes jin\./);
      expect(sent.messages.slice(-2)).toEqual([
        { role: 'assistant', content: '어서 와, jin.' },
        { role: 'user', content: '안녕' },
      ]);
    }));

  it('waits on the save a press on its greeting began and saves it once, then sends', () =>
    server.withSession(async (session) => {
      const { store } = session;
      await answerable(session);
      const character = await store.create('character', { card: luna, folder: null, loreFolders: [] });
      stubRelay(() => saying('왔구나.'));
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const greetings = projectGreetings(luna.greetings, [crypto.randomUUID(), crypto.randomUUID()], 0)!;
      const saved = startChat(store, chat, { title: null, character: character.ok ? character.data.id : null, models: {} }, greetings);
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' }, { greeting: greetings.choices[0]!.id, saved })).toBeNull();
      expect(await saved).toBeNull();
      expect(store.children('entry', chat).map(({ value }) => value.type).sort()).toEqual(['message', 'message', 'message', 'select', 'version']);
    }));

  it('takes no turn in a deleted chat', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await removeChat(session.store, chat);
      const log = stubRelay(inTurn([saying('안녕')]));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'Hi' })).toBeNull();
      expect([log, session.store.children('entry', chat)]).toEqual([[], []]);
    }));
});

describe('이어 쓰기', () => {
  it('continues on its own a reply cut at its length or left without its end, once, never a stop, a failure or an empty reply', () => {
    const cut = (over: Partial<Receipt>): Pick<Written, 'text' | 'receipt'> => ({
      text: '옛날 옛적에',
      receipt: { id: 'call', connection: 'c', source: 'OpenRouter', model: 'm', modelName: 'M', state: 'cut', cut: 'length', error: null, finishReason: 'length', usage: null, cost: null, replyId: null, firstTextMs: null, totalMs: 1, cache: null, ...over },
    });
    expect(autoContinue(cut({}))).toBe(true);
    expect(autoContinue(cut({ cut: 'no-terminal', finishReason: null }))).toBe(true);
    expect(autoContinue(cut({ cut: 'stopped' }))).toBe(false);
    expect(autoContinue(cut({ state: 'failed', cut: null }))).toBe(false);
    expect(autoContinue(cut({ continues: cut({}).receipt }))).toBe(false);
    expect(autoContinue({ ...cut({}), text: '' })).toBe(false);
  });

  it('continues a cut reply as it is saved: sends the chat ending in the cut text with the continue instruction, and saves the joined text in the cut version’s place, keeping both calls and its rolls', () =>
    server.withSession(async (session) => {
      const { log, reply, cut } = await cutReply(session, [saying(' 용이 살았어요.')]);
      expect(cut.receipt).toMatchObject({ state: 'cut', cut: 'length', cost: { unit: 'usd', amount: 0.002 } });

      await vi.waitFor(() => expect(shown(reply()).receipt?.state).toBe('done'));
      const [last, instruction] = lastTwo(log[1]!.sent.body);
      expect(last).toEqual({ role: 'assistant', content: '옛날 옛적에' });
      expect(instruction).toMatchObject({ role: 'user', content: expect.stringMatching(/^Your previous reply was cut off\./) });
      expect(reply().versions).toHaveLength(1);
      expect(shown(reply())).toMatchObject({ text: '옛날 옛적에 용이 살았어요.', receipt: { state: 'done', continues: cut.receipt }, seed: cut.seed });
    }));

  it('continues again on 다시 시도 after the continuation failed, so the cut text and every call stay', () =>
    server.withSession(async (session) => {
      const { chat, log, reply, cut } = await cutReply(session, [upstream(400, { error: { message: 'bad' } }), saying(' 끝.')]);
      await vi.waitFor(() => expect(shown(reply()).receipt?.state).toBe('failed'));
      // The failed version shows before its save lands, and the turn holds Talk until then.
      await vi.waitFor(() => expect(session.talk.snapshot(chat)).toBeNull());
      const failed = shown(reply());
      expect(failed).toMatchObject({ text: '옛날 옛적에', receipt: { state: 'failed', continues: cut.receipt } });

      expect(await takeTurn(session, chat, { kind: 'retry', message: reply().id, version: failed.id })).toBeNull();
      expect(lastTwo(log[2]!.sent.body)[0]).toEqual({ role: 'assistant', content: '옛날 옛적에' });
      expect(reply().versions).toHaveLength(1);
      expect(shown(reply())).toMatchObject({ text: '옛날 옛적에 끝.', receipt: { state: 'done', continues: failed.receipt } });
    }));
});

describe('반전 모드', () => {
  it('sends each message’s translation in place of its text, and the user’s new message as typed', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hello there', translation: { text: '안녕', receipt: null, at: 0 } });
      await setTranslate(session.store, null, { input: true, reverse: true });
      const log = stubRelay(inTurn([saying('Hi!')]));

      expect(await takeTurn(session, chat, { kind: 'send', text: '반가워' })).toBeNull();
      expect(log).toHaveLength(1);
      expect(lastTwo(log[0]!.sent.body)).toEqual([
        { role: 'user', content: '안녕' },
        { role: 'user', content: '반가워' },
      ]);
    }));
});

describe('내 메시지 번역', () => {
  it('translates the message first, sends the translation and saves it, with what the user typed as its translation and the language it went out in', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await setTranslate(session.store, null, { replies: false, input: true });
      const log = stubRelay(inTurn([saying('Hello there'), saying('Hi!')]));

      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      expect(lastTwo(log[0]!.sent.body)[1]).toEqual({ role: 'user', content: '안녕' });
      expect(lastTwo(log[1]!.sent.body).at(-1)).toEqual({ role: 'user', content: 'Hello there' });
      expect(shown(fold(session.store.children('entry', chat))[0]!)).toMatchObject({ text: 'Hello there', translation: { text: '안녕', receipt: { state: 'done' }, sentIn: 'English' } });
    }));

  it('sends and saves nothing when the message is not translated', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await setTranslate(session.store, null, { replies: false, input: true });
      const log = stubRelay(inTurn([upstream(400, { error: { message: 'bad' } })]));

      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toMatchObject({ kind: 'untranslated', failure: { kind: 'failed' } });
      expect(log).toHaveLength(1);
      expect(fold(session.store.children('entry', chat))).toEqual([]);
    }));
});

describe('상태', () => {
  it("shows each status script's box from the latest message that drew it, passing over a reply being written and an empty box", () => {
    const message = (id: string, live: boolean): Shown => ({ id, role: 'assistant', at: 0, versions: [{ id, seed: id, text: '', receipt: null, edited: false, at: 0 }], selected: 0, live: live ? id : null });
    const messages = [message('a', false), message('b', false), message('c', false), message('d', true)];
    const box = (html: string) => [{ script: 0, html, at: 'top' as const }];
    const boxes = [box('first'), box('second'), box(' '), box('half')];
    expect(statusBoxes({ texts: [], thoughts: [], css: '', drawn: [], boxes, pass: false, unfound: [], stopped: null }, messages, [{ id: 'a', place: 0 }, { id: 'b', place: 2 }])).toEqual([
      { id: 'a', place: 0, drawn: { script: 0, html: 'second', at: 'top', message: 1 } },
      { id: 'b', place: 2, drawn: null },
    ]);
  });

  it("places a module's status script after the character's, and marks nothing with one that is gone or turned off", () => {
    const script = (id: string, off?: true) => ({ id, name: '', find: 'x', replace: '', stage: 'display' as const, flags: null, ...(off && { off }) });
    const pack = (regex: ReturnType<typeof script>[]) => ({ regex, triggers: [], toggles: [] });
    const scripts = chatScripts([
      { id: 'own', pack: pack([script('a'), script('b', true), script('c')]), module: null },
      { id: 'bell', pack: pack([script('a')]), module: { namespace: null } },
    ]);
    expect(statusPlaces(scripts, ['c', 'b', 'gone', 'bell:a'])).toEqual([{ id: 'c', place: 2 }, { id: 'bell:a', place: 3 }]);
  });
});

describe('image-only models', () => {
  it('refuses a model that only makes images as the 대화 and the task model, before any call', () =>
    server.withSession(async (session) => {
      const painter = { id: 'nai-diffusion-5', name: 'V5', input: ['text' as const], output: ['image' as const], contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
      const connection = await session.store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [painter] });
      if (!connection.ok) throw new Error(connection.error);
      const ref = { connection: connection.data.id, model: painter.id };
      await setDefaultModel(session.store, 'main', ref);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const log = stubRelay(inTurn([]));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'Hi' })).toEqual({ kind: 'image-only' });
      expect(taskModel(session.store, { title: null, character: null, models: {} }, ref)).toEqual({ kind: 'image-only' });
      expect(log).toEqual([]);
    }));
});


it('runs tool prompts after Lua, regathers tool edits, and places both sets of writes before the reply', async () => {
  const key = 'tool:jin/test:ready';
  const binding: Binding<ToolUnit> = { close: () => {}, run: async (_chat, _units, scope, event) => {
    if (event.kind !== 'prompt') return noOutcome();
    expect(scope.pending).toContainEqual(['phase', 'lua']);
    return { ...noOutcome(), value: 'from the tool', writes: [[key, 'true']], edits: [{ index: 0, text: 'edited by tool', wrote: [] }] };
  } };
  await server.withSession(async (session) => {
    await answerable(session);
    const source = readTool(new TextEncoder().encode('//@api 1\n//@name test\n//@author jin'));
    if (!source.ok) throw new Error('fixture');
    const tool = await importTool(session.store, session.files, source.tool);
    if (!tool.ok) throw new Error(tool.error);
    await setModuleAlways(session.store, tool.data.id, true);
    const character = await session.store.create('character', { card: { ...luna, triggers: [{ kind: 'lua', id: 'onStart', name: '', code: 'function onStart(id) setChatVar(id, "phase", "lua") end' }] }, folder: null, loreFolders: [] });
    if (!character.ok) throw new Error(character.error);
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, null);
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'earlier' });
    const log = stubRelay(() => saying('reply'));
    expect(await takeTurn(session, chat, { kind: 'send', text: 'hello' })).toBeNull();
    await expect.poll(() => fold(session.store.children('entry', chat)).length).toBe(3);
    expect(log[0]!.sent.body).toContain('from the tool');
    expect(log[0]!.sent.body).toContain('edited by tool');
    expect(shown(fold(session.store.children('entry', chat)).at(-1)!).before).toEqual([['phase', 'lua'], [key, 'true']]);
  }, binding);
});

it('stops attachment preparation quietly when the turn is cancelled', () =>
  server.withSession(async (session) => {
    await answerable(session);
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Look at this picture' });
    const read = vi.spyOn(attachments, 'withPictures').mockImplementation((_session, _prompt, signal) => new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true });
    }));
    const log = stubRelay(() => saying('unused'));
    try {
      const turning = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      session.talk.stop(chat);
      expect(await turning).toBeNull();
      expect(log).toHaveLength(0);
    } finally {
      read.mockRestore();
    }
  }));
