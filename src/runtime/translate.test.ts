import { describe, expect, it, vi } from 'vitest';
import { fold, shown, type Message } from '../model/chat';
import { textTranslation } from '../model/library';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { setTranslate, setTranslatorNote } from './characters';
import { SETTINGS_ID } from '../model/settings';
import { setDefaultModel, setTaskModel } from './assignment';
import { setToolNote, translate, translatorOf, translateOnTool, translateText, type Translating } from './translate';
import { takeTurn } from './turn';
import { SHARED_CHAT } from './features';
import { translationInput } from './chat-context';

const server = testServer();

describe('Translator', () => {
  it('translates a reply received here, though its chat was left before the bot’s onOutput ended', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setTranslate(session.store, null, { replies: true });
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      const log = stubRelay(inTurn([new Response(stream.readable, { headers: { 'x-relay': 'upstream' } }), saying('안녕, 여행자.')]));
      // The bot's onOutput runs past the moment the reply lets its chat go.
      vi.spyOn(session.scriptTurns, 'ended').mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));
      const screen = vi.fn();
      const leave = session.talk.subscribe(screen);
      const turn = takeTurn(session, chat, { kind: 'answer' });
      await writer.write(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello, traveler."}}]}\n\n'));
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.text).toBe('Hello, traveler.'));
      expect(log).toHaveLength(1);
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      leave();
      lease.release();
      screen.mockClear();
      await writer.write(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      expect(await turn).toBeNull();

      await vi.waitFor(() => expect(log).toHaveLength(2));
      await vi.waitFor(() => expect(session.translator.snapshot().live.size).toBe(0));
      expect(screen).not.toHaveBeenCalled();
      await server.hold(session.store, chat);
      expect(shown(fold(session.store.children('entry', chat))[1]!).translation?.text).toBe('안녕, 여행자.');
    }));

  it('holds a received reply awaited from its save until its translation starts', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setTranslate(session.store, null, { replies: true });
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      stubRelay(inTurn([saying('Hello, traveler.'), saying('안녕, 여행자.')]));
      let ended = () => {};
      vi.spyOn(session.scriptTurns, 'ended').mockImplementation(() => new Promise((resolve) => { ended = () => resolve(); }));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      const reply = shown(fold(session.store.children('entry', chat))[1]!).id;
      expect(session.translator.snapshot().awaited).toEqual(new Set([reply]));
      const states: Translating[] = [];
      const leave = session.translator.subscribe(() => states.push(session.translator.snapshot()));
      ended();
      await vi.waitFor(() => expect(session.translator.snapshot().awaited.size).toBe(0));
      expect(states[0]).toMatchObject({ awaited: new Set(), live: new Map([[reply, '']]) });
      leave();
      lease.release();
    }));

  it('leaves a reply received before the switch went on to 번역', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      const log = stubRelay(inTurn([saying('Hello'), saying('안녕')]));
      await takeTurn(session, chat, { kind: 'answer' });
      await setTranslate(session.store, null, { replies: true });
      expect(session.translator.snapshot().live.size).toBe(0);
      expect(log).toHaveLength(1);
      const messages = () => fold(session.store.children('entry', chat));
      session.translator.translate(chat, shown(messages()[0]!), translationInput(session, chat, opened, messages(), { kind: 'message', index: 0 }));
      await vi.waitFor(() => expect(shown(messages()[0]!).translation?.text).toBe('안녕'));
    }));

  it('does not translate the latest reply of a chat it opens', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      const log = stubRelay(inTurn([saying('Hello')]));
      await takeTurn(session, chat, { kind: 'answer' });
      await setTranslate(session.store, null, { replies: true });
      const read = session.read.screen(chat, session.talk, session.illustrator, { chat: opened, messages: [] }, session.display);
      const leave = read.subscribe(() => {});
      await vi.waitFor(() => expect(read.snapshot().display.texts).toEqual(['Hello']));
      expect(session.translator.snapshot().live.size).toBe(0);
      expect(log).toHaveLength(1);
      leave();
    }));

  it('leaves a new chat’s greeting to 번역', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const card = { name: 'Luna', nickname: null, description: '', personality: '', scenario: '', greetings: ['Hello'], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } };
      const created = await session.store.create('character', { card, folder: null, loreFolders: [] });
      const character = created.ok ? created.data.id : '';
      await setTranslate(session.store, character, { replies: true });
      const chat = crypto.randomUUID();
      const opened = { title: null, character, models: {} };
      const version = crypto.randomUUID();
      const messages: Message[] = [{ id: version, role: 'assistant', at: 0, selected: 0, versions: [{ id: version, seed: version, text: 'Hello', receipt: null, edited: false, at: 0 }] }];
      const log = stubRelay(() => saying('안녕'));
      const read = session.read.screen(chat, session.talk, session.illustrator, { chat: opened, messages }, session.display);
      const leave = read.subscribe(() => {});
      await vi.waitFor(() => expect(read.snapshot().display.texts).toEqual(['Hello']));
      expect(session.translator.snapshot().live.size).toBe(0);
      expect(textTranslation(session.store.get('character', character)!.value, 'Hello', 'Korean')).toBeUndefined();
      expect(log).toHaveLength(0);
      leave();
    }));

  it('shows a reply’s translation as it comes, then saves it with the call’s receipt', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      const log = stubRelay(inTurn([saying('Hello, traveler.'), saying('안녕, 여행자.')]));
      await takeTurn(session, chat, { kind: 'answer' });
      const messages = () => fold(session.store.children('entry', chat));
      const reply = shown(messages()[1]!);

      const savedWhenLiveClears: boolean[] = [];
      const unsubscribe = session.translator.subscribe(() => {
        if (!session.translator.snapshot().live.has(reply.id)) savedWhenLiveClears.push(shown(messages()[1]!).translation !== undefined);
      });
      const heard: string[] = [];
      session.cues.subscribe((cue) => heard.push(cue));
      session.translator.translate(chat, reply, translationInput(session, chat, opened, messages(), { kind: 'message', index: 1 }));
      expect(session.translator.snapshot().live.get(reply.id)).toBe('');
      await vi.waitFor(() => expect(shown(messages()[1]!).translation).toMatchObject({ text: '안녕, 여행자.', receipt: { state: 'done' } }));
      await vi.waitFor(() => expect(session.translator.snapshot().live.size).toBe(0));
      expect(savedWhenLiveClears).toEqual([true]);
      expect(heard.filter((cue) => cue === 'translated')).toEqual(['translated']);
      unsubscribe();
      expect(JSON.parse(log[1]!.sent.body!).messages.at(-1)).toEqual({ role: 'user', content: 'Hello, traveler.' });
    }));

  it('lets a version be translated again after a translation that threw', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      vi.spyOn(session.credentials, 'get').mockRejectedValueOnce(new TypeError('lost'));
      const thrown = new Promise((resolve) => process.once('unhandledRejection', resolve));
      const input = translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' });

      session.translator.translate(chat, { id: 'v', seed: 'v', text: 'Hi', receipt: null, edited: false, at: 0 }, input);
      expect(await thrown).toBeInstanceOf(TypeError);
      expect(session.translator.snapshot().live.has('v')).toBe(false);
      session.translator.translate(chat, { id: 'v', seed: 'v', text: 'Hi', receipt: null, edited: false, at: 0 }, input);
      expect(session.translator.snapshot().live.get('v')).toBe('');
    }));

  it('stops before any call when the character’s translation prompt is gone', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await setTranslate(session.store, null, { prompt: crypto.randomUUID() });
      const log = stubRelay(inTurn([saying('안녕')]));

      const target = { id: crypto.randomUUID(), chat, result: crypto.randomUUID(), for: { kind: 'input', typed: 'Hi', language: 'English' } } as const;
      const made = await translate(session, translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' }), target, new AbortController().signal, () => {});
      expect(made).toEqual({ ok: false, failure: { kind: 'prompt-missing', own: true } });
      expect(log).toHaveLength(0);
    }));

  it('translates with the translation prompt’s own model, and without one with the chat’s 보조 모델', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const [connection] = session.store.list('connection');
      const starred = (id: string) => ({ ...connection!.value.starred[0]!, id, name: id });
      await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, starred('aux'), starred('tr')] }));
      const chat = { title: null, character: null, models: {} };
      const model = () => {
        const translator = translatorOf(session.store, chat);
        return translator.ok ? translator.route.model.id : translator.failure.kind;
      };
      expect(model()).toBe('m');
      await setDefaultModel(session.store, 'aux', { connection: connection!.id, model: 'aux' });
      expect(model()).toBe('aux');
      await setTaskModel(session.store, session.store.get('settings', SETTINGS_ID)!.value.translatePrompt!, { connection: connection!.id, model: 'tr' });
      expect(model()).toBe('tr');
    }));

  it('translates on 번역기 with 설정 › 모델’s 보조 모델, its own prompt and its own note, never the 전역 one', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const [connection] = session.store.list('connection');
      await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, { ...current.starred[0]!, id: 'aux', name: 'aux' }] }));
      await setDefaultModel(session.store, 'aux', { connection: connection!.id, model: 'aux' });
      await setTranslatorNote(session.store, null, 'Master -> 주인님');
      await setToolNote(session.store, 'Q3 -> 3분기');
      const log = stubRelay(inTurn([saying('3分期の報告です。')]));
      const fetched = vi.spyOn(globalThis, 'fetch');
      const made = await translateOnTool(session, 'The Q3 report.', 'Japanese', new AbortController().signal, () => {});
      expect(made).toMatchObject({ ok: true, translation: { text: '3分期の報告です。' } });
      const body = JSON.parse(log[0]!.sent.body!);
      expect(body.model).toBe('aux');
      const sent: { role: string; content: string }[] = body.messages;
      expect(sent.map(({ role }) => role)).toEqual(['system', 'system', 'user']);
      expect(sent[0]!.content).toContain('into Japanese.');
      expect(sent[0]!.content).not.toContain('roleplay');
      expect(sent[1]!.content).toContain('Q3 -> 3분기');
      expect(sent.some(({ content }) => content.includes('Master -> 주인님'))).toBe(false);
      expect(sent[2]!.content).toBe('The Q3 report.');
      expect(fetched.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url))).toEqual([expect.stringMatching(/^\/api\/streams\//)]);
    }));

  it('translates a character’s text with its 번역가의 노트 and without its card', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const card = { name: 'Luna', nickname: null, description: 'Luna keeps the lighthouse.', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } };
      const created = await session.store.create('character', { card, folder: null, loreFolders: [] });
      const character = created.ok ? created.data.id : '';
      await setTranslatorNote(session.store, character, 'Luna -> 루나');
      const log = stubRelay(inTurn([saying('루나는 등대를 지킨다.')]));
      await translateText(session, { title: null, character, models: {} }, card.description, 'Korean', new AbortController().signal, () => {});
      const sent: { content: string }[] = JSON.parse(log[0]!.sent.body!).messages;
      expect(sent.some(({ content }) => content.includes('Luna -> 루나'))).toBe(true);
      expect(sent.filter(({ content }) => content.includes(card.description))).toHaveLength(1);
    }));

  it('puts protected spans back into the translation, and fails one that lost a span rather than save it', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const log = stubRelay(inTurn([saying('⟦1⟧ 안녕.'), saying('안녕.')]));
      const live: string[] = [];
      const made = await translateText(session, SHARED_CHAT, '<img src="a.png"> Hi.', 'Korean', new AbortController().signal, (text) => live.push(text));
      expect(made).toMatchObject({ ok: true, translation: { text: '<img src="a.png"> 안녕.' } });
      expect(live.at(-1)).toBe('<img src="a.png"> 안녕.');
      expect(JSON.parse(log[0]!.sent.body!).messages.at(-1)).toEqual({ role: 'user', content: '⟦1⟧ Hi.' });
      expect(await translateText(session, SHARED_CHAT, '<img src="a.png"> Hi.', 'Korean', new AbortController().signal, () => {})).toEqual({ ok: false, failure: { kind: 'protected-lost', count: 1 } });
    }));

  it('keeps the protected spans on the call’s marker, for a page that picks the call up after a reload', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      stubRelay(inTurn([new Response(stream.readable, { headers: { 'x-relay': 'upstream' } })]));
      const version = { id: 'v', seed: 'v', text: '<img src="a.png"> Hi.', receipt: null, edited: false, at: 0 };
      void session.translator.translate(chat, version, translationInput(session, chat, opened, [], { kind: 'input', text: version.text }));
      await vi.waitFor(() => expect(session.store.list('stream').map(({ value }) => value.for)).toEqual([{ kind: 'translation', version: 'v', spans: ['<img src="a.png">'] }]));
      session.translator.close();
      await stream.writable.close();
    }));
});
