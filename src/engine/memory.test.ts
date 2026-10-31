import { describe, expect, it } from 'vitest';
import type { Chapter, Memory, MemoryRecord } from '../model/memory';
import { fingerprint, memoryBefore, memoryBudget, nextChapters, nextSpan, parseChapter, parseRecords, printOf, rawParts, recordsTarget, standing, windowStart, type ChatRead } from './memory';

const span = ['Luna: "I will  wait\nfor you until spring."', 'jin leaves the lighthouse.', 'Spring comes. Luna lights the lamp.'];
const record = (to: number, lines: { speaker: string; text: string }[] = []) => ({
  to,
  when: null,
  where: 'the lighthouse',
  who: ['Luna', 'jin'],
  what: 'Luna promises to wait.',
  lines,
  outcome: '',
  state: [{ about: 'Luna', field: 'waiting for', value: 'jin' }],
  opens: ['Luna waits for jin until spring.'],
  closes: [],
});
const answer = (records: unknown[]) => JSON.stringify({ records });

describe('parseRecords', () => {
  it('reads records that cover the span in order, with key lines found word for word apart from spacing and a fact that no longer holds, inside a fenced answer', () => {
    const removed = { ...record(3), state: [{ about: 'Luna', field: 'waiting for', value: null }] };
    const parsed = parseRecords('```json\n' + answer([record(2, [{ speaker: 'Luna', text: 'I will wait for you until spring.' }]), removed]) + '\n```', span);
    expect(parsed).toMatchObject({ ok: true, records: [{ to: 2, lines: [{ speaker: 'Luna' }] }, { to: 3, state: [{ value: null }] }] });
  });

  it('reads who written as one comma-separated string', () => {
    expect(parseRecords(answer([{ ...record(3), who: 'Luna, jin' }]), span)).toMatchObject({ ok: true, records: [{ who: ['Luna', 'jin'] }] });
  });

  it('keeps a key line quoted with other punctuation, or joining the sentences of one speech that narration separates, in order, and leaves out one the messages never said', () => {
    const said = ['Mira: "Meet me after school by the old bleachers," she says. *She turns.* "You\'re insane. So..." She smirks. "I like it."'];
    const line = (text: string) => answer([{ ...record(1), lines: [{ speaker: 'Mira', text }] }]);
    expect(parseRecords(line('Meet me after school by the old bleachers.'), said)).toMatchObject({ ok: true });
    expect(parseRecords(line("You're insane. So... I like it."), said)).toMatchObject({ ok: true });
    expect(parseRecords(line("I like it. You're insane."), said)).toMatchObject({ ok: true, records: [{ lines: [] }] });
  });

  it('refuses an answer that is not JSON, one with a field missing or a gap left, and a key line said by other messages', () => {
    expect(parseRecords('Here is the summary.', span)).toEqual({ ok: false, reason: 'unreadable' });
    expect(parseRecords(answer([[]]), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseRecords(answer([{ ...record(3), opens: undefined }]), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseRecords(answer([record(2)]), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseRecords(answer([record(1), record(3, [{ speaker: 'Luna', text: 'I will wait for you until spring.' }])]), span)).toMatchObject({ ok: true, records: [{ lines: [] }, { lines: [] }] });
  });
});

describe('recordsTarget', () => {
  it('asks for a fifth of the messages, within a quarter of the budget', () => {
    expect(recordsTarget(13_000, 25_000)).toBe(2600);
    expect(recordsTarget(100_000, 25_000)).toBe(6250);
  });
});

describe('fingerprint', () => {
  it('is the same for the same messages and differs for one changed letter or role', () => {
    const messages = [{ role: 'user', text: 'Hello.' }, { role: 'assistant', text: 'Hi.' }];
    expect(fingerprint(messages)).toBe(fingerprint(structuredClone(messages)));
    expect(fingerprint(messages)).not.toBe(fingerprint([messages[0]!, { role: 'assistant', text: 'Hi!' }]));
    expect(fingerprint(messages)).not.toBe(fingerprint([{ role: 'assistant', text: 'Hello.' }, messages[1]!]));
  });
});

describe('the window and the next span', () => {
  it('keeps raw the messages partly inside the window and always the last, and summarizes about batch tokens past it once they reach batch', () => {
    const tokens = [300, 300, 300, 300, 300, 300, 500, 200];
    expect(windowStart(tokens, 600)).toBe(6);
    expect(windowStart([5000], 600)).toBe(0);
    const settings = { window: 600, batch: 1000 };
    expect(nextSpan(tokens, 0, settings, 0)).toEqual({ from: 0, to: 3 });
    expect(nextSpan(tokens, 3, settings, 0)).toBeNull();
    expect(nextSpan(tokens, 3, settings, 1)).toEqual({ from: 3, to: 4 });
    expect(nextSpan([2000, 300], 0, { window: 300, batch: 1000 }, 0)).toEqual({ from: 0, to: 1 });
  });

  it('splits what is sent as written into the messages waiting for a summary and the window, the window starting at covered once a record reaches into it', () => {
    const tokens = [300, 300, 300, 300, 300, 300, 500, 200];
    expect(rawParts(tokens, 2, 600)).toEqual({ end: 6, waiting: 1200, recent: 700 });
    expect(rawParts(tokens, 7, 600)).toEqual({ end: 7, waiting: 0, recent: 200 });
  });

  it('shrinks a memory budget past half of what the model can take, for that request only', () => {
    expect([memoryBudget(25_000, 30_000), memoryBudget(25_000, 100_000), memoryBudget(25_000, null)]).toEqual([15_000, 25_000, 25_000]);
  });
});

describe('memoryBefore', () => {
  it("tells a memory task the state's size against its limit, and that it is over, with each thread's label", () => {
    const memory = { records: [], chapters: [], state: [{ about: 'Luna', field: 'mood', value: 'calm', record: null }], threads: [{ id: '1a2b3c4d-0000-4000-8000-000000000000', text: 'jin will come back.', opened: null }] };
    const text = memoryBefore(memory, null, 5, (each) => each.length);
    expect(text).toMatch(/^Current state \(\d+ of at most 5 tokens; over the limit, so remove or merge facts\):\n- Luna, mood: calm/);
    expect(text).toContain('- [T-1a2b3c4d] jin will come back.');
  });
});

describe('chapters and recall in what memory sends', () => {
  const texts = ['We reach the old lighthouse on the cliff, at last.', 'Luna opens the door.', 'I promise to come back.', 'Luna nods.', 'Morning comes.', 'Luna waits.'];
  const read: ChatRead = {
    shown: texts.map((_, index) => ({ message: `m${index}`, version: `v${index}` })),
    roles: texts.map((_, index) => (index % 2 ? 'assistant' : 'user')),
    speakers: texts.map((_, index) => (index % 2 ? 'Luna' : 'jin')),
    texts,
  };
  const count = (text: string) => text.length;
  const written = (id: string, indices: number[], what: string) => ({ id, sources: indices.map((index) => read.shown[index]!), print: printOf(read, indices), when: null, where: null, who: [], what, lines: [], outcome: '', receipt: null, at: 1 });
  const record = (id: string, indices: number[], what: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({ ...written(id, indices, what), state: [], opens: [], closes: [], ...over });
  const chapter = (id: string, records: MemoryRecord[], what: string, over: Partial<Chapter> = {}): Chapter => ({
    ...written(id, records.flatMap(({ sources }) => sources.map(({ message }) => Number(message.slice(1)))), what),
    records: records.map(({ id, at }) => ({ id, at })),
    ...over,
  });
  const memoryOf = (records: MemoryRecord[], chapters: Chapter[] = []): Memory => ({ records, chapters, state: [], threads: [] });

  it('sends a chapter in its records’ place, a pinned record in it beside it, and its records again once one changed or it went stale', () => {
    const [r1, r2, r3] = [record('r1', [0, 1], 'They arrive.'), record('r2', [2, 3], 'jin promises.', { pinned: true }), record('r3', [4], 'Morning.')];
    const c1 = chapter('c1', [r1, r2], 'jin and Luna arrive, and jin promises to come back.');
    const sent = standing(memoryOf([r1, r2, r3], [c1]), read, 10_000, count);
    expect([sent.sent, sent.status.get('r1'), sent.status.get('r2'), sent.held]).toEqual([['c1', 'r2', 'r3'], 'chaptered', 'sent', 5]);
    expect(sent.text.indexOf('jin and Luna arrive')).toBeLessThan(sent.text.indexOf('Morning.'));
    expect(sent.text).not.toContain('They arrive.');

    const edited = standing(memoryOf([{ ...r1, edited: true, at: 2 }, r2, r3], [c1]), read, 10_000, count);
    expect([edited.sent, edited.status.get('c1'), edited.stale.get('c1')]).toEqual([['r1', 'r2', 'r3'], 'stale', 'records']);
    const changed = standing(memoryOf([r1, r2, r3], [{ ...c1, print: 'rendered before' }]), read, 10_000, count);
    expect([changed.sent, changed.status.get('c1'), changed.stale.get('c1')]).toEqual([['c1', 'r2', 'r3'], 'sent', 'rendered']);
    const switched = standing(memoryOf([r1, r2, r3], [{ ...c1, sources: [{ ...c1.sources[0]!, version: 'older' }, ...c1.sources.slice(1)] }]), read, 10_000, count);
    expect([switched.sent, switched.status.get('c1'), switched.stale.get('c1')]).toEqual([['r1', 'r2', 'r3'], 'stale', 'changed']);

    const tight = standing(memoryOf([r1, r2, r3], [c1]), read, sent.costs.get('r2')! + sent.costs.get('r3')!, count);
    expect([tight.sent, tight.status.get('c1'), tight.status.get('r1'), tight.crowded]).toEqual([['r2', 'r3'], 'over', 'over', false]);
    expect([standing(memoryOf([r1, r2, r3]), read, 1, count).crowded, standing(memoryOf([r2]), read, 1, count).crowded, standing(memoryOf([r1, r3]), read, 1, count).crowded]).toEqual([true, false, false]);
  });

  it("sends a recalled record's messages with their speakers in its place, and its summary when they do not fit", () => {
    const [r1, r3] = [record('r1', [0, 1], 'They arrive.', { recalled: true }), record('r3', [4], 'Morning.')];
    const roomy = standing(memoryOf([r1, r3]), read, 10_000, count);
    expect([roomy.sent, roomy.status.get('r1')]).toEqual([['r1', 'r3'], 'sent']);
    expect(roomy.text).toContain('jin: We reach the old lighthouse on the cliff, at last.\nLuna: Luna opens the door.');
    expect(roomy.text).not.toContain('They arrive.');
    const tight = standing(memoryOf([r1, r3]), read, roomy.costs.get('r1')! + roomy.costs.get('r3')!, count);
    expect([tight.sent, tight.status.get('r1')]).toEqual([['r1', 'r3'], 'recall-over']);
    expect(tight.text).toContain('They arrive.');
  });

  it('takes the oldest run of loose records against the memory setting, never the budget shrunk for one request, within its read cap, and counts the chapters of the pass', () => {
    const records = texts.map((_, index) => record(`r${index}`, [index], `Event ${index} happens.`, index === 2 ? { pinned: true } : {}));
    const memory = memoryOf(records);
    const tokens = texts.map(count);
    const shrunk = standing(memory, read, 10, count);
    const setting = shrunk.fixed + shrunk.free;
    expect(nextChapters(memory, shrunk, read.shown, tokens, 2 * setting, Infinity, new Set())).toEqual([]);
    expect(nextChapters(memory, shrunk, read.shown, tokens, setting, Infinity, new Set())).toEqual([
      { from: 0, to: 2, records: ['r0', 'r1'], target: Math.ceil((shrunk.costs.get('r0')! + shrunk.costs.get('r1')!) / 4) },
      expect.objectContaining({ records: ['r3', 'r4'] }),
    ]);
    expect(nextChapters(memory, shrunk, read.shown, tokens, setting, tokens[3]! + tokens[4]!, new Set())).toEqual([expect.objectContaining({ from: 3, to: 5, records: ['r3', 'r4'] })]);
    expect(nextChapters(memory, shrunk, read.shown, tokens, setting, Infinity, new Set(['r0']))).toEqual([expect.objectContaining({ from: 3, records: ['r3', 'r4', 'r5'] })]);
    const reread = memoryOf(records.map((each) => (each.id === 'r0' ? { ...each, print: 'rendered before' } : each)));
    expect(nextChapters(reread, standing(reread, read, 10, count), read.shown, tokens, setting, Infinity, new Set())[0]).toMatchObject({ records: expect.arrayContaining(['r0']) });
  });

  it('starts again past a record that pairs with none in its read cap, leaves chapters and recalled messages out of what it can shrink, and makes no chapter once those fill the setting', () => {
    const records = texts.map((_, index) => record(`r${index}`, [index], `Event ${index} happens.`));
    const tokens = texts.map(count);
    const plain = memoryOf(records);
    const flat = standing(plain, read, 10, count);
    expect(nextChapters(plain, flat, read.shown, tokens, flat.fixed + flat.free, tokens[0]! + 10, new Set())[0]).toMatchObject({ records: ['r1', 'r2', 'r3'] });

    const told = memoryOf(records, [chapter('c0', records.slice(0, 3), 'They travel. '.repeat(200))]);
    const held = standing(told, read, 10, count);
    const loose = held.free - held.costs.get('c0')!;
    expect(nextChapters(told, held, read.shown, tokens, held.fixed + held.costs.get('c0')! + 2 * loose, Infinity, new Set())).toEqual([]);
    expect(nextChapters(told, held, read.shown, tokens, held.fixed + held.costs.get('c0')!, Infinity, new Set())).toEqual([]);
    expect(nextChapters(told, held, read.shown, tokens, held.fixed + held.costs.get('c0')! + loose, Infinity, new Set())).toEqual([expect.objectContaining({ records: ['r3', 'r4', 'r5'] })]);

    const recalled = memoryOf(records.map((each) => (each.id === 'r0' ? { ...each, recalled: true as const } : each)));
    const recalling = standing(recalled, read, 10, count);
    const room = recalling.fixed + recalling.recalls[0]! + recalling.free;
    expect(nextChapters(recalled, recalling, read.shown, tokens, room, Infinity, new Set())).toEqual([expect.objectContaining({ records: ['r1', 'r2', 'r3', 'r4'] })]);
  });
});

describe('parseChapter', () => {
  const span = ['Luna: "I will  wait\nfor you until spring."', 'jin leaves the lighthouse.'];
  const scene = { when: null, where: 'the lighthouse', who: ['Luna', 'jin'], what: 'Luna promises to wait, and jin leaves.', lines: [{ speaker: 'Luna', text: 'I will wait for you until spring.' }], outcome: '' };

  it('reads one chapter over the whole span and refuses a missing field or a key line the messages never said', () => {
    expect(parseChapter(JSON.stringify({ chapter: { ...scene, state: [{ about: 'Luna' }] } }), span)).toEqual({ ok: true, chapter: scene });
    expect(parseChapter(JSON.stringify({ chapter: { ...scene, outcome: undefined } }), span)).toEqual({ ok: false, reason: 'fields' });
    expect(parseChapter(JSON.stringify({ chapter: { ...scene, lines: [{ speaker: 'Luna', text: 'I will always wait.' }] } }), span)).toEqual({ ok: true, chapter: { ...scene, lines: [] } });
  });
});
