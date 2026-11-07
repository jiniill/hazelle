import { describe, expect, it } from 'vitest';
import { calls, ChatFold, chatTitle, fold, foldTree, previewLine, recentIn, recentModels, shown, standing, type Entry, type Message, type Receipt } from './chat';
import type { Stored } from './kinds';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const user = (id: string, text: string) => entry(id, { type: 'message', role: 'user', at: rev, text, receipt: null });
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: crypto.randomUUID(),
  connection: 'c1',
  source: 'OpenRouter',
  model: 'm1',
  modelName: 'Model One',
  state: 'done',
  cut: null,
  error: null,
  finishReason: 'stop',
  usage: null,
  cost: null,
  replyId: null,
  firstTextMs: 100,
  totalMs: 900,
  cache: null,
  ...over,
});
const bot = (id: string, text: string, over?: Partial<Receipt>) =>
  entry(id, { type: 'message', role: 'assistant', at: rev, text, receipt: receipt(over) });
const version = (id: string, message: string, text: string, replaces: string | null = null) =>
  entry(id, { type: 'version', message, replaces, edit: false, at: rev, text, receipt: receipt() });

describe('incremental chat projection', () => {
  it('refolds only the affected message through pending, confirmation, rollback and version removal', () => {
    const rows = new Map([user('u1', 'one'), user('u2', 'two')].map((row) => [row.id, row]));
    const projection = new ChatFold((id) => rows.get(id) ?? null);
    const apply = (row: Stored<'entry'>) => { rows.set(row.id, row); projection.changed(row.id); return projection.snapshot().messages; };
    for (const id of rows.keys()) projection.changed(id);
    const [first, second] = projection.snapshot().messages;
    const edit = { ...version('edit', 'u2', 'edited', 'u2'), rev: 0, pending: 1 };
    const pending = apply(edit);
    expect(pending[0]).toBe(first);
    expect(pending[1]).not.toBe(second);
    expect(shown(pending[1]!).text).toBe('edited');
    const confirmed = apply({ ...edit, rev: ++rev, pending: undefined });
    expect(confirmed[0]).toBe(first);
    expect(shown(confirmed[1]!).text).toBe('edited');
    const translation = entry('translation', { type: 'translation', version: 'edit', text: 'translated', receipt: null, at: 0 });
    expect(shown(apply(translation)[1]!).translation?.text).toBe('translated');
    rows.delete('edit'); projection.changed('edit');
    const rolledBack = projection.snapshot().messages;
    expect(rolledBack[0]).toBe(first);
    expect(shown(rolledBack[1]!).text).toBe('two');
    expect(shown(rolledBack[1]!).translation).toBeUndefined();
    expect(shown(apply(edit)[1]!).translation).toBeUndefined();
    expect(shown(apply({ ...edit, rev: translation.rev - 1, pending: undefined })[1]!).translation?.text).toBe('translated');
  });

  it('invalidates shared receipt costs and carries deleted-message variables without mutating old snapshots', () => {
    const rows = new Map<string, Stored<'entry'>>();
    const projection = new ChatFold((id) => rows.get(id) ?? null);
    const apply = (row: Stored<'entry'>) => { rows.set(row.id, row); projection.changed(row.id); return projection.snapshot().messages; };
    apply(user('u1', 'one'));
    apply(bot('b1', 'two', { replyId: 'shared', cost: 'pending' }));
    apply(bot('b2', 'three', { continues: receipt({ replyId: 'shared', cost: 'pending' }) }));
    const before = apply(entry('vars', { type: 'vars', version: 'b1', set: [['door', 'open']], stays: true, at: 0 }));
    const cost = entry('cost', { type: 'cost', replyId: 'shared', cost: { unit: 'usd', amount: 1, source: 'reported' }, at: 0 });
    const priced = apply(cost);
    expect(priced[0]).toBe(before[0]);
    expect(shown(priced[1]!).receipt?.cost).toEqual(cost.value.type === 'cost' && cost.value.cost);
    expect(shown(priced[2]!).receipt?.continues?.cost).toEqual(cost.value.type === 'cost' && cost.value.cost);
    const deleted = apply(entry('delete', { type: 'delete', message: 'b1', at: 0 }));
    expect(deleted.map(({ id }) => id)).toEqual(['u1', 'b2']);
    expect(deleted[0]!.after).toEqual([['door', 'open']]);
    expect(priced[0]!.after).toBeUndefined();
    expect(deleted[1]).toBe(priced[2]);
    rows.delete('cost'); projection.changed('cost');
    expect(shown(projection.snapshot().messages[1]!).receipt?.continues?.cost).toBe('pending');
    expect(apply(entry('restore', { type: 'restore', message: 'b1', at: 0 }))[0]).toBe(before[0]);
  });
});

describe('fold', () => {
  it('orders by rev, not by the order entries arrive in', () => {
    const entries = [user('u1', '안녕'), bot('b1', '반가워')];
    expect(fold(entries.reverse()).map((message) => message.id)).toEqual(['u1', 'b1']);
  });

  it('shows a new version, and a select moves between versions', () => {
    const entries = [bot('b1', '하나'), version('v2', 'b1', '둘')];
    expect(shown(fold(entries)[0]!).text).toBe('둘');
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(shown(fold(entries)[0]!).text).toBe('하나');
  });

  it('puts an edit or a retry in the place of the version it replaces', () => {
    const entries = [bot('b1', '하나'), version('v2', 'b1', '둘'), version('e1', 'b1', '하나 고침', 'b1')];
    const [message] = fold(entries);
    expect(message!.versions.map((v) => v.text)).toEqual(['하나 고침', '둘']);
    expect(message!.selected).toBe(0);
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'v2', at: 0 }), entry('s2', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(shown(fold(entries)[0]!).text).toBe('하나 고침');
  });

  it('leads a version replaced more than once to the one standing in its place, for a device that still shows the first', () => {
    const twice = [user('m1', 'v0'), version('v1', 'm1', 'v1', 'm1'), version('v2', 'm1', 'v2', 'v1'), version('other', 'm1', 'other')];
    const selected = fold([...twice, entry('s1', { type: 'select', message: 'm1', version: 'm1', at: 0 })])[0]!;
    expect([selected.versions.map(({ text }) => text), selected.selected]).toEqual([['v2', 'other'], 0]);
    const edited = fold([...twice, version('v3', 'm1', 'v3', 'm1')])[0]!;
    expect([edited.versions.map(({ text }) => text), edited.selected]).toEqual([['v3', 'other'], 0]);
  });

  it('keeps a text past the scripts staged through its edit, never through a retry or a new version', () => {
    const edit = (id: string, replaces: string) => entry(id, { type: 'version', message: 'b1', replaces, edit: true, at: rev, text: '고침', receipt: null });
    const entries = [entry('b1', { type: 'message', role: 'assistant', at: rev, text: '하나', receipt: null, staged: true }), edit('e1', 'b1'), version('v2', 'b1', '둘'), edit('e2', 'v2')];
    expect(fold(entries)[0]!.versions.map((v) => v.staged)).toEqual([true, undefined]);
    expect(fold([...entries.slice(0, 1), version('r1', 'b1', '다시', 'b1')])[0]!.versions[0]!.staged).toBeUndefined();
  });

  it('gives a version the latest translation made of it, never one made of the version it replaced', () => {
    const made = (text: string) => ({ text, receipt: receipt(), at: rev });
    const entries = [bot('b1', 'Hello'), entry('t1', { type: 'translation', version: 'b1', ...made('안녕') }), entry('t2', { type: 'translation', version: 'b1', ...made('안녕하세요') })];
    expect(shown(fold(entries)[0]!).translation?.text).toBe('안녕하세요');
    entries.push(version('b2', 'b1', 'Hi', 'b1'), entry('t3', { type: 'translation', version: 'b1', ...made('늦은 번역') }));
    expect(shown(fold(entries)[0]!).translation).toBeUndefined();
  });

  it('gives each version its own continuation, and reads a message saved before follows as continuing every version saved before it', () => {
    const ids = (entries: Stored<'entry'>[]) => fold(entries).map(({ id }) => id);
    const swiped = [bot('c1', '하나'), version('c1v2', 'c1', '둘'), user('c2', '셋')];
    expect(ids([...swiped, entry('cs', { type: 'select', message: 'c1', version: 'c1', at: 0 })])).toEqual(['c1', 'c2']);

    const entries = [user('u1', '하나'), bot('b1', '둘'), user('u2', '셋'), bot('b2', '넷'), version('b1v2', 'b1', '둘 다시')];
    expect(ids(entries)).toEqual(['u1', 'b1']);
    entries.push(entry('u3', { type: 'message', role: 'user', at: rev, text: '다섯', receipt: null, follows: 'b1v2' }));
    expect(ids(entries)).toEqual(['u1', 'b1', 'u3']);
    expect(ids([...entries, entry('d1', { type: 'delete', message: 'b1', at: 0 })])).toEqual(['u1', 'u3']);
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(ids(entries)).toEqual(['u1', 'b1', 'u2', 'b2']);
    expect(foldTree(entries).map(({ message, follows }) => [message.id, follows])).toEqual([['u1', null], ['b1', 'u1'], ['u2', 'b1'], ['b2', 'u2'], ['u3', 'b1v2']]);
  });

  it('starts a separate line when follows names an unknown version or a message saved later', () => {
    const entries = [
      user('u1', 'first'),
      entry('missing', { type: 'message', role: 'user', at: 0, text: 'unknown', receipt: null, follows: 'absent' }),
      entry('early', { type: 'message', role: 'user', at: 0, text: 'future', receipt: null, follows: 'later-version' }),
      entry('later', { type: 'message', role: 'assistant', at: 0, text: 'later', receipt: null, follows: null }),
      version('later-version', 'later', 'new version'),
    ];
    expect(fold(entries).map(({ id }) => id)).toEqual(['u1', 'missing', 'early', 'later']);
    expect(foldTree(entries).map(({ message, follows }) => [message.id, follows])).toEqual([
      ['u1', null], ['missing', null], ['early', null], ['later', null],
    ]);
  });

  it('starts a separate line when follows names a future version of an earlier message', () => {
    const entries = [
      user('u1', 'first'),
      entry('early', { type: 'message', role: 'user', at: 0, text: 'future', receipt: null, follows: 'v2' }),
      version('v2', 'u1', 'later version'),
      entry('select', { type: 'select', message: 'u1', version: 'u1', at: 0 }),
    ];
    expect(fold(entries).map(({ id }) => id)).toEqual(['u1', 'early']);
    expect(foldTree(entries).map(({ message, follows }) => [message.id, follows])).toEqual([['u1', null], ['early', null]]);
  });

  it('reads a message after the one a follow entry names, even one saved later, and passes over a move that would loop', () => {
    const entries = [
      user('u1', 'first'),
      bot('b1', 'reply'),
      user('u2', 'second'),
      entry('i1', { type: 'message', role: 'user', at: 0, text: 'inserted', receipt: null, follows: 'b1' }),
      entry('f1', { type: 'follow', message: 'u2', follows: 'i1', at: 0 }),
    ];
    expect(fold(entries).map(({ id }) => id)).toEqual(['u1', 'b1', 'i1', 'u2']);
    expect(foldTree(entries).map(({ message, follows }) => [message.id, follows])).toEqual([['u1', null], ['b1', 'u1'], ['i1', 'b1'], ['u2', 'i1']]);
    const looped = [...entries, entry('f2', { type: 'follow', message: 'i1', follows: 'u2', at: 0 })];
    expect(fold(looped).map(({ id }) => id)).toEqual(['u1', 'b1', 'i1', 'u2']);
  });

  it('keeps the place of a message put ahead of one of two continuations saved after the same version', () => {
    const entries = [
      user('u1', 'first'),
      bot('b1', 'reply from one device'),
      entry('b2', { type: 'message', role: 'assistant', at: 0, text: 'reply from the other', receipt: receipt(), follows: 'u1' }),
      entry('i1', { type: 'message', role: 'user', at: 0, text: 'inserted', receipt: null, follows: 'u1' }),
      entry('f1', { type: 'follow', message: 'b1', follows: 'i1', at: 0 }),
    ];
    expect(fold(entries).map(({ id }) => id)).toEqual(['u1', 'i1', 'b1', 'b2']);
    const again = [...entries,
      entry('i2', { type: 'message', role: 'user', at: 0, text: 'inserted ahead', receipt: null, follows: 'u1' }),
      entry('f2', { type: 'follow', message: 'i1', follows: 'i2', at: 0 }),
    ];
    expect(fold(again).map(({ id }) => id)).toEqual(['u1', 'i2', 'i1', 'b1', 'b2']);
  });

  it('hides a deleted message until it is restored', () => {
    const entries = [user('u1', '안녕'), entry('d1', { type: 'delete', message: 'u1', at: 0 })];
    expect(fold(entries)).toEqual([]);
    entries.push(entry('r1', { type: 'restore', message: 'u1', at: 0 }));
    expect(fold(entries).map((message) => message.id)).toEqual(['u1']);
  });

  it('settles a pending cost from a later cost entry', () => {
    const entries = [bot('b1', '답', { cost: 'pending', replyId: 'gen_1' })];
    expect(shown(fold(entries)[0]!).receipt!.cost).toBe('pending');
    entries.push(entry('k1', { type: 'cost', replyId: 'gen_1', cost: { unit: 'usd', amount: 0.01, source: 'reported' }, at: 0 }));
    expect(shown(fold(entries)[0]!).receipt!.cost).toEqual({ unit: 'usd', amount: 0.01, source: 'reported' });
  });

  it('settles the pending cost of a cut call a continued version carries, and keeps both calls', () => {
    const cut = receipt({ state: 'cut', cut: 'length', cost: 'pending', replyId: 'gen_1' });
    const entries = [
      entry('b1', { type: 'message', role: 'assistant', at: 0, text: '옛날', receipt: cut }),
      entry('c1', { type: 'version', message: 'b1', replaces: 'b1', edit: false, at: 0, text: '옛날 옛적에', receipt: receipt({ continues: cut }) }),
      entry('k1', { type: 'cost', replyId: 'gen_1', cost: { unit: 'usd', amount: 0.01, source: 'reported' }, at: 0 }),
    ];
    const [message] = fold(entries);
    expect(message!.versions).toHaveLength(1);
    expect(calls(shown(message!).receipt!).map((call) => [call.state, call.cost])).toEqual([
      ['cut', { unit: 'usd', amount: 0.01, source: 'reported' }],
      ['done', null],
    ]);
  });
});

describe("fold with the bot's Lua writes", () => {
  it('keeps them with a version through its edits, and leaves them behind on a retry', () => {
    const edit = (id: string, replaces: string, before?: [string, string][]) => entry(id, { type: 'version', message: 'b1', replaces, edit: true, at: rev, text: id, receipt: receipt(), ...(before && { before }) });
    const entries = [
      entry('b1', { type: 'message', role: 'assistant', at: rev, text: '하나', receipt: receipt(), before: [['turn', '1']] }),
      entry('w1', { type: 'vars', version: 'b1', set: [['hp', '9']], at: rev }),
      entry('h1', { type: 'vars', version: 'b1', set: [['hp', '5']], at: rev, byHand: true }),
      edit('e1', 'b1', [['mood', 'calm']]),
      entry('w2', { type: 'vars', version: 'b1', set: [['hp', '8']], at: rev }),
      edit('e2', 'e1'),
      entry('w3', { type: 'vars', version: 'e1', set: [['hp', '7']], at: rev }),
    ];
    expect(shown(fold(entries)[0]!)).toMatchObject({ id: 'e2', before: [['turn', '1'], ['mood', 'calm']], after: [['hp', '9'], ['hp', '8'], ['hp', '7']], byHand: [['hp', '5']] });
    const retried = shown(fold([...entries, version('r1', 'b1', '다시', 'e2')])[0]!);
    expect([retried.before, retried.after, retried.byHand]).toEqual([undefined, undefined, undefined]);
  });

  it('leads every id a version stood under through its edits to it, and none through a retry', () => {
    const edit = (id: string, replaces: string) => entry(id, { type: 'version', message: 'b1', replaces, edit: true, at: rev, text: id, receipt: receipt() });
    const edited = [bot('b1', '하나'), edit('e1', 'b1'), edit('e2', 'e1')];
    expect([...standing(fold(edited))]).toEqual([['b1', 'e2'], ['e1', 'e2'], ['e2', 'e2']]);
    expect([...standing(fold([...edited, version('r1', 'b1', '다시', 'e2')]))]).toEqual([['r1', 'r1']]);
  });

  it('keeps what a button wrote with its message whichever version is shown, and with the message before once its own is deleted', () => {
    const entries = [user('u1', '안녕'), bot('b1', '하나'), entry('w1', { type: 'vars', version: 'b1', set: [['door', 'open']], at: rev, stays: true }), version('v2', 'b1', '둘')];
    expect(fold(entries)[1]).toMatchObject({ after: [['door', 'open']] });
    expect(shown(fold(entries)[1]!).after).toBeUndefined();
    const [left] = fold([...entries, entry('d1', { type: 'delete', message: 'b1', at: rev })]);
    expect(left).toMatchObject({ id: 'u1', after: [['door', 'open']] });
  });
});

const asStored = (messages: Message[]) => messages.map((message) => shown(message).text);

describe('chatTitle', () => {
  it('uses the given title, then a branch its origin, then the first line of the first message', () => {
    const messages = fold([user('u1', '  기숙사 첫날\n둘째 줄')]);
    expect(chatTitle({ title: null, character: null, models: {} }, messages, asStored(messages))).toBe('기숙사 첫날');
    expect(chatTitle({ title: '이름', character: null, models: {} }, messages, asStored(messages))).toBe('이름');
    expect(chatTitle({ title: null, character: null, models: {}, origin: { id: 'a', name: '기숙사의 밤', after: 'u1' } }, messages, asStored(messages))).toBe('기숙사의 밤 · 분기');
    expect(chatTitle({ title: null, character: null, models: {} }, [], [])).toBe('새 채팅');
  });

  it('reads an untitled whole copy as its origin with · 사본', () => {
    expect(chatTitle({ title: null, character: null, models: {}, origin: { id: 'a', name: '기숙사의 밤', after: null } }, [], [])).toBe('기숙사의 밤 · 사본');
  });
});

describe('recentModels', () => {
  it('lists each model once, newest first', () => {
    const one = fold([bot('b1', 'a', { model: 'm1' }), bot('b2', 'b', { model: 'm2' })]);
    const two = fold([bot('b3', 'c', { model: 'm1' })]);
    expect(recentModels([recentIn(one), recentIn(two)], 5)).toEqual([
      { connection: 'c1', model: 'm1' },
      { connection: 'c1', model: 'm2' },
    ]);
  });

  it("names a copy's reply by the copy's key", () => {
    expect(recentIn(fold([bot('b1', 'a', { model: 'm1', entry: '#low' }), bot('b2', 'b', { model: 'm1' })]))).toEqual([
      { at: expect.any(Number), ref: { connection: 'c1', model: 'm1' } },
      { at: expect.any(Number), ref: { connection: 'c1', model: '#low' } },
    ]);
  });
});

describe('previewLine', () => {
  it('passes a status line for the first line of prose, and keeps a message that is all status', () => {
    const own = (text: string) => previewLine(text, text);
    expect(own('⏱️[2025-03-15 (토요일) 오후 05:36]\n\n"으응..." 그녀가 눈을 떴다.')).toBe('"으응..." 그녀가 눈을 떴다.');
    expect(own('# Response\n<div>The moment Steve called</div>')).toBe('The moment Steve called');
    expect(own('[HP 3/10]\n---')).toBe('[HP 3/10]');
  });

  it('passes the prose a bot script brought in, such as a settings panel, for the message\'s own', () => {
    const panel = '<div class="settings-panel"><div>System Configuration</div></div>\n<p>The lobby  buzzed.</p>';
    expect(previewLine(panel, 'The lobby buzzed.')).toBe('The lobby  buzzed.');
    expect(previewLine(panel, '{{user}}')).toBe('System Configuration');
    expect(previewLine('<div>System Configuration</div>\nLuna enters the lobby.\nShe waves.', '{{char}} enters the lobby.\nShe waves.')).toBe('Luna enters the lobby.');
  });
});
