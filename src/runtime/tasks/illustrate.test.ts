import { describe, expect, it, vi } from 'vitest';
import type { ConnectionType } from '../../connectors/types';
import { fold, shown } from '../../model/chat';
import { setIllustrate } from '../library/characters';
import { appendUserMessage, setChatOwn, startChat } from '../chat/chat-log';
import type { Session } from '../session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from '../testing';
import { blankCard } from '../../engine/import/card';
import { placeMark, type Drawn } from '../../model/illustration';
import { COMIC_PAGE, lastScene, seenBy, severalScenes } from '../../engine/illustrate';
import { takeTurn } from '../chat/turn';
import { removeIllustration, restoreIllustration } from './illustrate';
import { likenessId } from '../../model/likeness';
import { editPortrait, removeLikeness, removePortrait, restoreLikeness } from './likeness';
import { addPersona } from '../library/personas';

const { PAINTER } = vi.hoisted(() => {
  const PAINTER: ConnectionType = {
    browser: {},
    id: 'fake-draws',
    label: 'Painter',
    group: 'maker',
    description: '',
    endpoint: { baseUrl: 'https://image.example', protocol: 'chat-completions' },
    draws: {
      samplers: [],
      request: (picture) => ({ url: 'https://image.example/generate', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picture) }),
      authHeaders: (secret) => ({ authorization: `Bearer ${secret}` }),
      parse: async (bytes, type) => (type === 'image/png' ? { bytes, type } : null),
      free: { request: () => ({ url: 'https://image.example/free', method: 'GET', headers: {}, body: null }), costs: (payload) => ((payload as { free: boolean }).free ? null : 'allowance') },
    },
  };
  return { PAINTER };
});

vi.mock('../../connectors/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../connectors/registry')>();
  return { ...real, resolveConnection: (connection: Parameters<typeof real.resolveConnection>[0]) => (connection.type === PAINTER.id ? { ...real.resolveConnection({ ...connection, type: 'openrouter' })!, type: PAINTER } : real.resolveConnection(connection)) };
});

const server = testServer();

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const picture = () => new Response(PNG, { headers: { 'x-relay': 'upstream', 'content-type': 'image/png' } });
const free = (answer: boolean) => upstream(200, { free: answer });
const scene = { after: 2, shape: 'portrait', setting: '1girl, indoors, night', framing: 'cowboy shot', characters: [{ name: 'Ari', look: 'girl, silver hair', outfit: 'white dress', action: 'smile', x: 0.5, y: 0.5 }] };
const REPLY = 'She opened the door.\nThe room was dark.\n\nShe smiled.';
const SCENE = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };

async function painted(session: Session, starred = true) {
  await answerable(session);
  const model = { id: 'v5', name: 'V5', input: ['text' as const], output: ['image' as const], contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
  await session.store.create('connection', { type: PAINTER.id, label: 'Painter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'pk-secret' }], turns: null, starred: starred ? [model] : [] });
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
  return chat;
}

describe('Illustrator', () => {
  it('draws a reply received with auto on: one scene call, one image call, the picture stored for its version', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      await setIllustrate(session.store, null, { auto: true });
      const log = stubRelay(inTurn([saying(REPLY), saying(JSON.stringify(scene)), free(true), picture()]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();

      // The reply's save, the bot's onOutput, the scene's evaluation and both calls run in turn: more than waitFor's
      // default second on a loaded machine.
      // The run's state clears after the picture is stored, not with it.
      await vi.waitFor(() => {
        expect(session.store.children('illustration', chat)).toHaveLength(1);
        expect(session.illustrator.snapshot().size).toBe(0);
      }, { timeout: 5000 });
      const reply = fold(session.store.children('entry', chat))[1]!;
      const value = session.store.children('illustration', chat)[0]!.value as Drawn;
      expect(value).toMatchObject({ message: reply.id, version: shown(reply).id, scene: { paragraph: 1, shape: 'portrait' }, receipt: { state: 'done' }, sent: { width: 832, height: 1216, characters: [{ center: { x: 0.5, y: 0.5 } }] }, type: 'image/png', size: PNG.byteLength });
      expect(log).toHaveLength(4);
      expect(log[1]!.sent.body).toContain('[2] The room was dark.');
      expect(log[2]!.sent.url).toBe('https://image.example/free');
      expect(log[3]!.sent).toMatchObject({ url: 'https://image.example/generate', headers: { authorization: 'Bearer pk-secret' } });
      expect(JSON.parse(log[3]!.sent.body!)).toMatchObject({ seed: value.sent.seed, prompt: expect.stringContaining('1girl, indoors, night, cowboy shot') });
      const read = await session.files.read(value.file);
      expect(read.ok && [...read.data]).toEqual([...PNG]);
    }));

  it('writes as many scenes as the reply’s length earns in one call, and draws each in turn', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      await setIllustrate(session.store, null, { auto: true, spend: true, ladder: [{ from: REPLY.length - 20, count: 2 }, { from: REPLY.length * 2, count: 5 }] });
      const scenes = [scene, { ...scene, after: 2, shape: 'square' }, { ...scene, after: 3 }, { ...scene, after: 1 }];
      const log = stubRelay(inTurn([saying(REPLY), saying(JSON.stringify(scenes)), picture(), picture()]));
      await takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => {
        expect(session.store.children('illustration', chat)).toHaveLength(2);
        expect(session.illustrator.snapshot().size).toBe(0);
      }, { timeout: 5000 });
      expect(log[1]!.sent.body).toContain(severalScenes(2));
      expect(log).toHaveLength(4);
      // A paragraph already taken drops its scene, and so does one past the count.
      const drawn = session.store.children('illustration', chat).map(({ value }) => value as Drawn);
      expect(drawn.map(({ scene }) => scene.paragraph).sort()).toEqual([1, 2]);
      expect(drawn[0]!.receipt!.id).toBe(drawn[1]!.receipt!.id);
    }));

  it('draws no picture not known to be free until the user agrees to spend, then draws it from the same scene', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      await setIllustrate(session.store, null, { auto: true });
      const log = stubRelay(inTurn([saying(REPLY), saying(JSON.stringify(scene)), free(false), picture()]));
      await takeTurn(session, chat, { kind: 'answer' });
      const reply = fold(session.store.children('entry', chat))[1]!;
      await vi.waitFor(() => expect(session.illustrator.snapshot().get(reply.id)).toMatchObject({ writing: false, failure: null, sketches: [{ failure: { kind: 'costs', why: 'allowance' }, scene: { paragraph: 1 } }] }), { timeout: 5000 });
      expect(log).toHaveLength(3);
      const failed = session.illustrator.snapshot().get(reply.id)!.sketches[0]!;
      session.illustrator.draw(chat, reply.id, shown(reply).id, { scene: failed.scene, spend: true });
      await vi.waitFor(() => expect(session.store.children('illustration', chat)).toHaveLength(1));
      expect(log).toHaveLength(4);
      expect(log[3]!.sent.url).toBe('https://image.example/generate');
    }));

  it('draws without asking whether the picture is free while the switches spend', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      await setIllustrate(session.store, null, { auto: true, spend: true });
      const log = stubRelay(inTurn([saying(REPLY), saying(JSON.stringify(scene)), picture()]));
      await takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.store.children('illustration', chat)).toHaveLength(1), { timeout: 5000 });
      expect(log.map(({ sent }) => sent.url)).not.toContain('https://image.example/free');
    }));

  it('tells the scene call the last picture, draws through the persona’s eyes and as a manga page only while switched on, and takes the persona out', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      const jin = await addPersona(session.store, { name: 'Jin', description: '', picture: null });
      if (!jin.ok) throw new Error(jin.error);
      await session.store.update('chat', chat, (current) => ({ ...current, persona: jin.data.id }));
      await setIllustrate(session.store, null, { auto: true, spend: true });
      const both = { ...scene, characters: [...scene.characters, { name: 'jin', look: 'boy', outfit: '', action: 'wave', x: 0.2, y: 0.5 }] };
      const log = stubRelay((sent) => (sent.body?.includes('You direct the illustrations') ? saying(JSON.stringify(both)) : sent.url.endsWith('/generate') ? picture() : saying(REPLY)));
      await takeTurn(session, chat, { kind: 'answer' });
      const reply = fold(session.store.children('entry', chat))[1]!;
      const drawn = async (count: number) => {
        await vi.waitFor(() => {
          expect(session.store.children('illustration', chat)).toHaveLength(count);
          expect(session.illustrator.snapshot().has(reply.id)).toBe(false);
        }, { timeout: 5000 });
        return session.store.children('illustration', chat).map(({ value }) => value as Drawn).sort((a, b) => a.at - b.at).at(-1)!;
      };
      const first = await drawn(1);
      await setIllustrate(session.store, null, { pov: true, comic: true });
      session.illustrator.draw(chat, reply.id, shown(reply).id);
      const second = await drawn(2);
      const [before, after] = log.filter(({ sent }) => sent.body?.includes('You direct the illustrations')).map(({ sent }) => sent.body!);
      const told = (text: string) => JSON.stringify(text).slice(1, -1);
      for (const direction of [seenBy('Jin'), COMIC_PAGE]) {
        expect(before).not.toContain(told(direction));
        expect(after).toContain(told(direction));
      }
      expect(before).not.toContain('The last picture of this chat');
      expect(after).toContain(told(lastScene({ scene: first.scene, ago: 0 })));
      expect(first.scene.characters.map(({ name }) => name)).toEqual(['Ari', 'jin']);
      expect(second.scene).toMatchObject({ framing: 'pov, cowboy shot', characters: [{ name: 'Ari' }] });
      expect(second.scene.characters).toHaveLength(1);
    }));

  it('refuses before any call when no starred model draws, and keeps the failure for the slot', () =>
    server.withSession(async (session) => {
      const chat = await painted(session, false);
      const log = stubRelay(inTurn([saying(REPLY)]));
      await takeTurn(session, chat, { kind: 'answer' });
      const reply = fold(session.store.children('entry', chat))[1]!;
      session.illustrator.draw(chat, reply.id, shown(reply).id);
      await vi.waitFor(() => expect(session.illustrator.snapshot().get(reply.id)).toMatchObject({ writing: false, failure: { kind: 'no-image-model' }, sketches: [] }));
      expect(log).toHaveLength(1);
      session.illustrator.dismiss(reply.id);
      expect(session.illustrator.snapshot().has(reply.id)).toBe(false);
    }));

  it('marks a picture’s paragraph in the text the screen displays, keeps the mark out of its texts, and loses it with a script that drops the line', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const merging = { id: 'merge', name: 'merge', find: 'dark\\.\\n.*', replace: 'dark.', stage: 'display' as const, flags: null };
      const shownOn = async (regex: (typeof merging)[]) => {
        const made = await session.store.create('character', { card: { ...blankCard('Ari'), regex }, folder: null, loreFolders: [] });
        if (!made.ok) throw new Error(made.error);
        const chat = crypto.randomUUID();
        await server.hold(session.store, chat);
        const opened = { title: null, character: made.data.id, models: {} };
        await startChat(session.store, chat, opened, null);
        await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
        stubRelay(inTurn([saying(REPLY)]));
        await takeTurn(session, chat, { kind: 'answer' });
        const reply = fold(session.store.children('entry', chat))[1]!;
        const file = await session.files.save([PNG]);
        const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
        await session.store.create('illustration', { message: reply.id, version: shown(reply).id, scene: { ...SCENE, paragraph: 1 }, receipt: null, model: { connection: 'c', model: 'm' }, sent, file: file.ok ? file.data[0]! : { id: '', key: '' }, type: 'image/png', size: 1, at: 1 }, { parent: chat });
        const read = session.read.screen(chat, session.talk, session.illustrator, { chat: opened, messages: [] }, session.display);
        const leave = read.subscribe(() => {});
        await vi.waitFor(() => expect(read.snapshot().display.texts[1]).toContain('She'));
        leave();
        return read.snapshot();
      };

      const plain = await shownOn([]);
      expect(plain.display.texts).toEqual(['Go on', REPLY]);
      expect(plain.placed).toEqual(new Map([[1, `She opened the door.\nThe room was dark.\n${placeMark(1)}\n\nShe smiled.`]]));
      const merged = await shownOn([merging]);
      expect([merged.display.texts[1], merged.placed.size]).toEqual(['She opened the door.\nThe room was dark.\n\nShe smiled.', 0]);
    }));

  it('deletes a picture at once and 되돌리기 brings it back under its id', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      const saved = await session.files.save([PNG]);
      const file = saved.ok ? saved.data[0]! : { id: '', key: '' };
      const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
      const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
      const made = await session.store.create('illustration', { message: 'm', version: 'v', scene, receipt: null, model: { connection: 'c', model: 'm' }, sent, file, type: 'image/png', size: PNG.byteLength, at: 1 }, { parent: chat });
      if (!made.ok) throw new Error(made.error);
      const removed = await removeIllustration(session.store, made.data.id);
      expect(session.store.children('illustration', chat)).toEqual([]);
      if (!removed.ok) throw new Error(removed.error);
      await restoreIllustration(session.store, removed.data);
      expect(session.store.children('illustration', chat).map(({ id, value }) => [id, value.file])).toEqual([[made.data.id, file]]);
    }));
});

// A PNG holding NovelAI's prompt in its Comment chunk, as the bot's own pictures carry it.
function prompted(prompt: string) {
  const text = new TextEncoder().encode(`Comment\0${JSON.stringify({ prompt })}`);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out;
  };
  return new Uint8Array([...PNG.slice(0, 8), ...chunk('tEXt', text), ...chunk('IEND', new Uint8Array())]);
}

// Each runs a turn and two draws, past the default 5 s on a loaded machine.
describe('Illustrator with profiles', { timeout: 15_000 }, () => {
  const PROFILES = 'You write character profiles';
  const looks = { characters: [{ name: 'Ari', aliases: ['아리'], look: 'girl, profile silver hair', outfits: [{ name: 'usual', tags: 'maid uniform' }], source: 'metadata' }] };
  const bare = { ...scene, characters: [{ ...scene.characters[0]!, outfit: '' }] };
  // By what each request asks.
  const answering = (profiles: string) => (sent: { url: string; body: string | null }) =>
    sent.body?.includes(PROFILES) ? saying(profiles) : sent.body?.includes('You direct the illustrations') ? saying(JSON.stringify(bare)) : sent.url.endsWith('/free') ? free(true) : sent.url.endsWith('/generate') ? picture() : saying(REPLY);

  async function drawing(session: Session, profiles: string) {
    const chat = await painted(session);
    const made = await session.store.create('character', { card: { ...blankCard('Ari'), description: 'Ari is a maid.' }, folder: null, loreFolders: [] });
    if (!made.ok) throw new Error(made.error);
    const bytes = prompted('1girl, {artist:pen}, silver hair, maid');
    const file = await session.files.save([bytes]);
    await session.store.create('asset', { name: 'Ari_smile.png', type: 'image/png', size: bytes.length, file: file.ok ? file.data[0]! : { id: '', key: '' } }, { parent: made.data.id });
    await session.store.update('chat', chat, (current) => ({ ...current, character: made.data.id }));
    const log = stubRelay(answering(profiles));
    await takeTurn(session, chat, { kind: 'answer' });
    const reply = fold(session.store.children('entry', chat))[1]!;
    const draw = async () => {
      const count = session.store.children('illustration', chat).length;
      session.illustrator.draw(chat, reply.id, shown(reply).id);
      // The picture shows before its write is answered, and a draw asked while the last is still saving is dropped:
      // wait for the run to end too.
      await vi.waitFor(() => {
        expect(session.store.children('illustration', chat)).toHaveLength(count + 1);
        expect(session.illustrator.snapshot().has(reply.id)).toBe(false);
      }, { timeout: 5000 });
    };
    return { owner: made.data.id, chat, log, draw, profileCalls: () => log.filter(({ sent }) => sent.body?.includes(PROFILES)) };
  }

  it("builds the character's profiles beside its first draw, from its text and its pictures' metadata, draws the figure from them, and never builds again", () =>
    server.withSession(async (session) => {
      const { owner, chat, log, draw, profileCalls } = await drawing(session, JSON.stringify(looks));
      await draw();
      const stored = session.store.get('likeness', likenessId(owner));
      expect(stored).toMatchObject({ parent: owner, value: { portraits: [{ name: 'Ari', look: 'girl, profile silver hair', artist: '{artist:pen}', source: 'metadata' }], receipt: { state: 'done' } } });
      expect(profileCalls()[0]!.sent.body).toContain('Ari is a maid.');
      expect(profileCalls()[0]!.sent.body).toContain('1girl, {artist:pen}, silver hair, maid');
      const sent = JSON.parse(log.find(({ sent }) => sent.url.endsWith('/generate'))!.sent.body!);
      expect(sent).toMatchObject({ prompt: expect.stringMatching(/^\{artist:pen\}, 1girl, indoors/), characters: [{ prompt: 'girl, profile silver hair, maid uniform, smile' }] });
      expect((session.store.children('illustration', chat)[0]!.value as Drawn).sent.characters[0]!.prompt).toBe('girl, profile silver hair, maid uniform, smile');
      await draw();
      expect(profileCalls()).toHaveLength(1);
    }));

  it("builds a 등장인물's profiles from its own card beside the character's", () =>
    server.withSession(async (session) => {
      const { chat, draw, profileCalls } = await drawing(session, JSON.stringify({ characters: [{ ...looks.characters[0], source: 'text' }] }));
      const bea = await session.store.create('character', { card: { ...blankCard('Bea'), description: 'Bea is a knight.' }, folder: null, loreFolders: [] });
      if (!bea.ok) throw new Error(bea.error);
      await session.store.update('chat', chat, (current) => ({ ...current, cast: [bea.data.id] }));
      await draw();
      expect(profileCalls().some(({ sent }) => sent.body?.includes('Bea is a knight.'))).toBe(true);
      expect(session.store.get('likeness', likenessId(bea.data.id))).toMatchObject({ parent: bea.data.id });
    }));

  it("builds the chat's persona's profile from its description, and draws the user's figure from it", () =>
    server.withSession(async (session) => {
      const { chat, draw } = await drawing(session, JSON.stringify(looks));
      const jin = await addPersona(session.store, { name: 'Jin', description: 'Jin is a traveler.', picture: null });
      if (!jin.ok) throw new Error(jin.error);
      await session.store.update('chat', chat, (current) => ({ ...current, persona: jin.data.id }));
      const own = { characters: [{ name: 'Jin', aliases: [], look: 'boy, black hair', outfits: [{ name: 'usual', tags: 'travel cloak' }], source: 'text' }] };
      const both = { ...bare, characters: [...bare.characters, { name: 'jin', look: 'boy', outfit: '', action: 'wave', x: 0.2, y: 0.5 }] };
      const log = stubRelay((sent) =>
        sent.body?.includes('You direct the illustrations') ? saying(JSON.stringify(both)) : sent.body?.includes('The user’s character: Jin') ? saying(JSON.stringify(own)) : answering(JSON.stringify(looks))(sent),
      );
      await draw();
      expect(session.store.get('likeness', likenessId(jin.data.id))).toMatchObject({ parent: jin.data.id, value: { portraits: [{ name: 'Jin', look: 'boy, black hair' }] } });
      const sent = JSON.parse(log.find(({ sent }) => sent.url.endsWith('/generate'))!.sent.body!);
      expect(sent.characters.map(({ prompt }: { prompt: string }) => prompt)).toEqual(['girl, profile silver hair, maid uniform, smile', 'boy, black hair, travel cloak, wave']);
    }));

  it('saves no profile for a blank persona, so the description written later is read on the next draw', () =>
    server.withSession(async (session) => {
      const { chat, draw, profileCalls } = await drawing(session, JSON.stringify(looks));
      const blank = await addPersona(session.store, { name: 'Jin', description: '', picture: null });
      if (!blank.ok) throw new Error(blank.error);
      await session.store.update('chat', chat, (current) => ({ ...current, persona: blank.data.id }));
      await draw();
      expect(session.store.get('likeness', likenessId(blank.data.id))).toBeNull();
      expect(profileCalls().filter(({ sent }) => sent.body?.includes('Jin'))).toEqual([]);
      await session.store.update('persona', blank.data.id, (current) => ({ ...current, description: 'Jin is a traveler.' }));
      await draw();
      expect(profileCalls().some(({ sent }) => sent.body?.includes('Jin is a traveler.'))).toBe(true);
    }));

  it("asks the connection's model list when the starred model's inputs are unknown, and keeps what it says", () =>
    server.withSession(async (session) => {
      const { draw } = await drawing(session, JSON.stringify(looks));
      const listed = { data: [{ id: 'm', name: 'M', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }] };
      stubRelay((sent) => (sent.url.endsWith('/models') ? upstream(200, listed) : answering(JSON.stringify(looks))(sent)));
      await draw();
      const connection = session.store.list('connection').find(({ value }) => value.type === 'openrouter')!;
      expect(connection.value.starred[0]!.input).toEqual(['text', 'image']);
    }));

  it('draws without the profiles when their build fails, writes none, keeps the failure, and tries again on the next draw', () =>
    server.withSession(async (session) => {
      const { owner, log, draw, profileCalls } = await drawing(session, 'Ari has silver hair.');
      await draw();
      expect(session.store.get('likeness', likenessId(owner))).toBeNull();
      expect(session.likenesses.snapshot().get(owner)).toMatchObject({ stage: 'failed', failure: { kind: 'invalid', reason: 'unreadable' } });
      expect(JSON.parse(log.find(({ sent }) => sent.url.endsWith('/generate'))!.sent.body!).characters[0].prompt).toBe('girl, silver hair, smile');
      await draw();
      expect(profileCalls()).toHaveLength(2);
    }));

  it('tells the scene call the profiles’ names, then the outfit each was last drawn in, and 다시 만들기 keeps a portrait edited by hand, answering what it replaced', () =>
    server.withSession(async (session) => {
      const { owner, chat, log, draw, profileCalls } = await drawing(session, JSON.stringify(looks));
      await draw();
      await draw();
      const sceneCalls = log.filter(({ sent }) => sent.body?.includes('You direct the illustrations'));
      expect(sceneCalls[0]!.sent.body).toMatch(/- Ari \(also called 아리\), outfits: \\"usual\\""\}/);
      expect(sceneCalls[0]!.sent.body).not.toContain("notes for this chat's pictures");
      expect(sceneCalls[1]!.sent.body).toContain('- Ari (also called 아리), outfits: \\"usual\\"; last drawn in \\"usual\\" in this message');
      expect((await setChatOwn(session.store, chat, 'illustrateNote', 'Ari wears the usual, rainy night')).ok).toBe(true);
      await draw();
      expect(log.filter(({ sent }) => sent.body?.includes('You direct the illustrations'))[2]!.sent.body).toContain("notes for this chat's pictures, which outrank the message: what to draw, how, and who wears what.\\n---\\nAri wears the usual, rainy night");
      expect(await editPortrait(session.store, owner, { index: 0, name: 'Nobody' }, { look: 'boy' })).toMatchObject({ ok: false, error: 'gone' });
      expect((await editPortrait(session.store, owner, { index: 0, name: 'Ari' }, { outfits: [{ name: 'usual', tags: 'swimsuit' }] })).ok).toBe(true);
      const edited = session.store.get('likeness', likenessId(owner))!;
      expect(edited.value.portraits[0]).toMatchObject({ look: 'girl, profile silver hair', outfits: [{ name: 'usual', tags: 'swimsuit' }], source: 'user' });
      const replaced = await session.likenesses.rebuild(owner);
      expect(profileCalls()).toHaveLength(2);
      expect(replaced?.value).toBe(edited.value);
      expect(session.store.get('likeness', likenessId(owner))!.value.portraits).toEqual(edited.value.portraits);
    }));

  it('a removed portrait stays gone on the next draw, the whole profiles are made again, and 되돌리기 writes back what was there', () =>
    server.withSession(async (session) => {
      const { owner, draw, profileCalls } = await drawing(session, JSON.stringify(looks));
      await draw();
      const removed = await removePortrait(session.store, owner, { index: 0, name: 'Ari' });
      expect(session.store.get('likeness', likenessId(owner))!.value.portraits).toEqual([]);
      await draw();
      expect(profileCalls()).toHaveLength(1);
      expect((await restoreLikeness(session.store, removed.ok ? removed.data : expect.fail())).ok).toBe(true);
      expect(session.store.get('likeness', likenessId(owner))!.value.portraits[0]).toMatchObject({ name: 'Ari' });
      expect((await removeLikeness(session.store, owner)).ok).toBe(true);
      expect(session.store.get('likeness', likenessId(owner))).toBeNull();
      await draw();
      expect(profileCalls()).toHaveLength(2);
    }));
});
