import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '../history';
import type { LoreEntry } from '../import/types';
import { onProgress } from '../progress';
import { greetingRule, prepareLore, type Activation, type LoreEntries, type LoreScan, type LoreTurn } from './activate';

const SCAN: LoreScan = { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false };

const lore = (id: string, value: Partial<Omit<LoreEntry, 'folder'>>) => ({
  id,
  value: {
    name: id,
    keys: [],
    secondaryKeys: [],
    content: id,
    enabled: true,
    constant: false,
    selective: false,
    useRegex: false,
    caseSensitive: false,
    insertionOrder: 100,
    priority: null,
    position: null,
    ...value,
  },
});
const chat = (...texts: string[]): HistoryMessage[] => texts.map((text, i) => ({ id: `m${i}`, message: `m${i}`, seed: `m${i}`, role: i % 2 ? 'assistant' : 'user', text, time: null }));
const run = (entries: LoreEntries, history: HistoryMessage[], more: Partial<LoreTurn> & { settings?: Partial<LoreScan> } = {}) =>
  prepareLore(entries, { ...SCAN, ...more.settings }).activate({ history, greeting: 0, afterMatch: [], seed: 'send', cost: (_, body) => body.length, marks: new Set(['main', 'globalNote']), ...more });
const order = (activation: Activation) => activation.placed.map(({ id }) => id);
const ids = (activation: Activation) => order(activation).sort();
const why = (activation: Activation, id: string) => activation.fired.find((fired) => fired.id === id)?.why;

describe('activate', () => {
  it('gives a sign of life for each entry it scans', () => {
    let signs = 0;
    onProgress(() => signs++);
    try {
      run([lore('dragon', { keys: ['dragon'] }), lore('sword', { keys: ['sword'] })], chat('a dragon'), { settings: { recursive: false } });
    } finally {
      onProgress(() => {});
    }
    expect(signs).toBe(2);
  });

  it('honors enabled: false and fires constant entries without keys (row 5a)', () => {
    const result = run([lore('always', { constant: true }), lore('off', { constant: true, enabled: false }), lore('keyless', {})], chat('hi'));
    expect(result.fired).toEqual([{ id: 'always', why: { kind: 'constant' }, fate: { kind: 'placed', tokens: 6 } }]);
  });

  it('matches plain keys in any case unless the entry is case-sensitive (row 5b), ignoring spacing and CBS comments', () => {
    const entries = [lore('any', { keys: ['Red Dragon'] }), lore('exact', { keys: ['Red Dragon'], caseSensitive: true }), lore('comment', { keys: ['secret'] })];
    expect(ids(run(entries, chat('a reddragon {{// secret}} {{comment::secret}}')))).toEqual(['any']);
    expect(ids(run(entries, chat('the Red  Dragon')))).toEqual(['any', 'exact']);
  });

  it('matches whole words at letter and digit boundaries in full-word mode, per entry', () => {
    const settings = { fullWordMatching: true };
    const entries = [
      lore('word', { keys: ['cat'] }),
      lore('exact', { keys: ['cat'], caseSensitive: true }),
      lore('phrase', { keys: ['old  man'] }),
      lore('partial', { keys: ['cat'], content: '@@match_partial_word\npartial' }),
    ];
    expect(ids(run(entries, chat('"Cat!" said the old\nman.'), { settings }))).toEqual(['partial', 'phrase', 'word']);
    expect(ids(run(entries, chat('concatenate'), { settings }))).toEqual(['partial']);
    expect(ids(run(entries, chat('a cat'), { settings }))).toEqual(['exact', 'partial', 'word']);
  });

  it('compiles regex keys as written, mixed with plain keys, and reports those that do not compile (row 2)', () => {
    const entries = [
      lore('regex', { useRegex: true, keys: ['/drag(o|oo)n/', 'castle'] }),
      lore('flags', { useRegex: true, keys: ['/^the KING$/mi'] }),
      lore('cased', { useRegex: true, keys: ['/DRAGOON/'] }),
      lore('broken', { useRegex: true, keys: ['/(/', '/unclosed', 'moat'] }),
    ];
    const result = run(entries, chat('a dragoon\nThe King'));
    expect(ids(result)).toEqual(['flags', 'regex']);
    expect(result.invalidKeys).toEqual([
      { entry: 'broken', key: '/(/' },
      { entry: 'broken', key: '/unclosed' },
    ]);
    expect(ids(run(entries, chat('the moat by the castle')))).toEqual(['broken', 'regex']);
  });

  it('needs a secondary key when selective, every @@additional_keys line, and no @@exclude_keys key, and says where each matched', () => {
    const entries = [
      lore('selective', { keys: ['sword'], secondaryKeys: ['fire'], selective: true }),
      lore('additional', { keys: ['sword'], content: '@@additional_keys fire\n@@additional_keys ice, frost\nadditional' }),
      lore('exclude', { keys: ['sword'], content: '@@exclude_keys ice,water\nexclude' }),
    ];
    expect(ids(run(entries, chat('a sword', 'of fire')))).toEqual(['exclude', 'selective']);
    const frost = run(entries, chat('a sword', 'of fire and frost'));
    expect(ids(frost)).toEqual(['additional', 'exclude', 'selective']);
    expect(why(frost, 'additional')).toEqual({
      kind: 'keys',
      matched: [
        { query: 'primary', key: 'sword', source: { kind: 'message', id: 'm0' } },
        { query: 'additional', key: 'fire', source: { kind: 'message', id: 'm1' } },
        { query: 'additional', key: 'frost', source: { kind: 'message', id: 'm1' } },
      ],
    });
    expect(ids(run(entries, chat('a sword of fire and ice')))).toEqual(['additional', 'selective']);
  });

  it('excludes on @@exclude_keys_all when every key appears anywhere in the scanned text (row 4)', () => {
    const entries = [lore('guard', { keys: ['gate'], content: '@@exclude_keys_all night,rain\nguard' })];
    expect(ids(run(entries, chat('the gate at night', 'rain falls')))).toEqual([]);
    expect(ids(run(entries, chat('the gate at night')))).toEqual(['guard']);
  });

  it("scans the last scanDepth messages, 5 by default, or the entry's own @@scan_depth", () => {
    const history = chat('dragon', 'one', 'two', 'three', 'four', 'five');
    const entries = [
      lore('default', { keys: ['dragon'] }),
      lore('deep', { keys: ['dragon'], content: '@@scan_depth 6\ndeep' }),
      lore('none', { keys: ['five'], content: '@@scan_depth 0\nnone' }),
    ];
    expect(ids(run(entries, history))).toEqual(['deep']);
    expect(ids(run(entries, history, { settings: { scanDepth: 6 } }))).toEqual(['deep', 'default']);
  });

  it('scans the bodies of fired entries in later passes and names the entry a key matched in', () => {
    const entries = [
      lore('castle', { keys: ['castle'], content: 'The castle has a moat.' }),
      lore('moat', { keys: ['moat'], content: 'The moat hides an eel.' }),
      lore('eel', { keys: ['eel'], content: '@@no_recursive_search\neel' }),
      lore('flat', { keys: ['castle'], content: '@@unrecursive\nThe castle has a tower.' }),
      lore('tower', { keys: ['tower'] }),
    ];
    const result = run(entries, chat('to the castle'));
    expect(ids(result)).toEqual(['castle', 'flat', 'moat']);
    expect(why(result, 'moat')).toEqual({ kind: 'keys', matched: [{ query: 'primary', key: 'moat', source: { kind: 'entry', id: 'castle' } }] });
    expect(ids(run(entries, chat('to the castle'), { settings: { recursive: false } }))).toEqual(['castle', 'flat']);
  });

  it('reads a recursive body from the next entry in the same pass, so a later @@exclude_keys stops on it at once', () => {
    const entries = [
      lore('before', { keys: ['gate'], content: '@@exclude_keys BLOCKED\nbefore' }),
      lore('wall', { keys: ['gate'], content: 'BLOCKED' }),
      lore('after', { keys: ['gate'], content: '@@exclude_keys BLOCKED\nafter' }),
    ];
    expect(ids(run(entries, chat('the gate')))).toEqual(['before', 'wall']);
  });

  it('retains earlier key and exclusion evidence while consuming only new recursive bodies', () => {
    const entries = [
      lore('first', { constant: true, content: 'rain key-two red' }),
      lore('second', { keys: ['key-two'], content: 'preferred blue go' }),
      lore('target', { keys: ['preferred', 'fallback'], selective: true, secondaryKeys: ['blue'], content: '@@additional_keys red\n@@additional_keys go\ntarget' }),
      lore('excluded', { keys: ['preferred', 'fallback'], selective: true, secondaryKeys: ['blue'], content: '@@exclude_keys_all night,rain\nexcluded' }),
    ];
    const result = run(entries, chat('fallback red night'));
    expect(ids(result)).toEqual(['first', 'second', 'target']);
    expect(why(result, 'target')).toEqual({ kind: 'keys', matched: [
      { query: 'primary', key: 'preferred', source: { kind: 'entry', id: 'second' } },
      { query: 'secondary', key: 'blue', source: { kind: 'entry', id: 'second' } },
      { query: 'additional', key: 'red', source: { kind: 'message', id: 'm0' } },
      { query: 'additional', key: 'go', source: { kind: 'entry', id: 'second' } },
    ] });
  });

  it('rolls @@probability once per entry per send, so a later pass does not roll again (row 9)', () => {
    const entries = [lore('maybe', { keys: ['omen'], content: '@@probability 50\nmaybe' }), lore('echo', { keys: ['omen'], content: 'another omen' })];
    const lost = run(entries, chat('an omen'), { seed: 'send-2' });
    expect(ids(lost)).toEqual(['echo']);
    expect(lost.fired.filter(({ id }) => id === 'maybe').map(({ fate }) => fate)).toEqual([{ kind: 'dropped', cause: 'probability' }]);
    expect(ids(run(entries, chat('an omen'), { seed: 'send-1' }))).toEqual(['echo', 'maybe']);
  });

  it('keeps the after-match flags to their own entry, and remembers only entries that went in (row 8)', () => {
    const entries = [
      lore('sticky', { keys: ['bell'], content: '@@keep_activate_after_match\nsticky' }),
      lore('once', { keys: ['bell'], content: '@@dont_activate_after_match\nonce' }),
      lore('plain', { keys: ['bell'] }),
      lore('big', { keys: ['bell'], content: `@@keep_activate_after_match\n${'x'.repeat(900)}` }),
    ];
    const first = run(entries, chat('a bell'));
    expect(first.afterMatch.sort()).toEqual(['once', 'sticky']);
    const quiet = run(entries, chat('quiet'), { afterMatch: first.afterMatch });
    expect(ids(quiet)).toEqual(['sticky']);
    expect(why(quiet, 'sticky')).toEqual({ kind: 'decorator', name: 'keep_activate_after_match' });
    expect(ids(run(entries, chat('a bell'), { afterMatch: first.afterMatch }))).toEqual(['plain', 'sticky']);
  });

  it('prepares effective sticky entries once and scans only demanded messages across replay end indexes', () => {
    let reads = 0;
    const history = chat('bell', 'quiet', 'quiet', 'quiet').map((message) => ({ ...message, get text() { reads++; return message.text; } }));
    const entries = [lore('sticky', { keys: ['bell'], content: '@@scan_depth 3\n@@unknown\n@@@keep_activate_after_match\nsticky' })];
    const book = prepareLore(entries, { ...SCAN, scanDepth: 1 });
    const input = { history: history.slice(0, 3), greeting: null, afterMatch: [], seed: 'send', cost: (_: string, body: string) => body.length, marks: new Set<string>() };
    const first = book.activate(input);
    expect(book.sticky).toBe(true);
    expect(first.afterMatch).toEqual(['sticky']);
    expect(why(book.activate({ ...input, history, afterMatch: first.afterMatch }), 'sticky')).toEqual({ kind: 'decorator', name: 'keep_activate_after_match' });
    expect(reads).toBe(3);
    expect(book.activate(input).fired).toEqual(first.fired);
    expect(reads).toBe(3);
    expect(prepareLore([{ ...entries[0]!, value: { ...entries[0]!.value, enabled: false } }], SCAN).sticky).toBe(false);
  });

  it('names the greeting an entry opens with, as activation reads it', () => {
    expect(greetingRule(lore('second', { content: '@@is_greeting 1\nsecond' }).value)).toBe(1);
    expect(greetingRule(lore('plain', { content: 'is_greeting 1' }).value)).toBeNull();
  });

  it('gates on the turn and the greeting, @@is_greeting 0 being first_mes as in Risu, and fires @@activate without keys under the same gates', () => {
    const entries = [
      lore('late', { constant: true, content: '@@activate_only_after 4\nlate' }),
      lore('even', { content: '@@activate\n@@activate_only_every 2\neven' }),
      lore('first', { constant: true, content: '@@is_greeting 0\nfirst' }),
      lore('second', { constant: true, content: '@@is_greeting 1\nsecond' }),
    ];
    expect(ids(run(entries, chat('a', 'b'), { greeting: 1 }))).toEqual(['second']);
    expect(ids(run(entries, chat('a', 'b', 'c'), { greeting: 0 }))).toEqual(['even', 'first', 'late']);
    expect(ids(run(entries, chat('a', 'b', 'c'), { greeting: null }))).toEqual(['even', 'late']);
  });

  it('lists in lorebook order each entry that did not fire with the first reason, leaving out those that matched and dropped', () => {
    const entries = [
      lore('fires', { keys: ['a'] }),
      lore('off', { constant: true, enabled: false }),
      lore('never', { constant: true, content: '@@dont_activate\nnever' }),
      lore('once', { constant: true, content: '@@dont_activate_after_match\n@@activate_only_after 4\nonce' }),
      lore('late', { constant: true, content: '@@activate_only_after 4\nlate' }),
      lore('even', { constant: true, content: '@@activate_only_every 2\neven' }),
      lore('second', { constant: true, content: '@@is_greeting 1\nsecond' }),
      lore('keyless', {}),
      lore('missing', { keys: ['zebra'] }),
      lore('unlucky', { keys: ['a'], content: '@@probability 0\nunlucky' }),
    ];
    expect(run(entries, chat('a', 'b'), { afterMatch: ['once'] }).silent).toEqual([
      { id: 'off', why: { kind: 'closed', cause: 'disabled' } },
      { id: 'never', why: { kind: 'closed', cause: 'never' } },
      { id: 'once', why: { kind: 'closed', cause: 'after-match' } },
      { id: 'late', why: { kind: 'closed', cause: 'only-after', from: 4 } },
      { id: 'even', why: { kind: 'closed', cause: 'only-every', every: 2 } },
      { id: 'second', why: { kind: 'closed', cause: 'greeting' } },
      { id: 'keyless', why: { kind: 'keyless' } },
      { id: 'missing', why: { kind: 'unmatched' } },
    ]);
  });

  it('skips by priority what does not fit the budget, then lists by insertion order, ties last-fired first', () => {
    const entries = [
      lore('low', { constant: true, insertionOrder: 1, content: 'x'.repeat(50) }),
      lore('high', { constant: true, insertionOrder: 3, priority: 9, content: 'x'.repeat(60) }),
      lore('mid', { constant: true, insertionOrder: 2, content: `@@priority 5\n${'x'.repeat(30)}` }),
      lore('last', { constant: true, insertionOrder: 0, content: '@@ignore_on_max_context\nx' }),
    ];
    const result = run(entries, [], { settings: { tokenBudget: 100 } });
    expect(order(result)).toEqual(['last', 'mid', 'high']);
    expect(result.fired.find(({ id }) => id === 'low')?.fate).toEqual({ kind: 'dropped', cause: 'budget', tokens: 50 });
    expect(order(run([lore('a', { constant: true }), lore('b', { constant: true })], []))).toEqual(['b', 'a']);
  });

  it('lists entries of one insertion order before the description in the order they fired, as Risu does (row 10)', () => {
    const entries = [lore('a', { constant: true, content: '@@position before_desc\na' }), lore('b', { constant: true, content: '@@position before_desc\nb' }), lore('c', { constant: true, content: '@@position after_desc\nc' }), lore('d', { constant: true, content: '@@position after_desc\nd' })];
    expect(order(run(entries, []))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('lists entries before the description, CCv3 before_char ones too, highest insertion order first, and after it lowest first, as Risu does', () => {
    const at = (id: string, insertionOrder: number, side: string) => lore(id, { constant: true, insertionOrder, content: `${side}\n${id}` });
    const entries = [at('a', 1, '@@position before_desc'), at('b', 5, '@@position before_desc'), at('c', 10, '@@position before_desc'), at('d', 5, '@@position before_desc'), at('e', 1, '@@position after_desc'), at('f', 10, '@@position after_desc'), lore('g', { constant: true, insertionOrder: 7, position: 'before_char' })];
    expect(order(run(entries, []))).toEqual(['e', 'f', 'c', 'g', 'b', 'd', 'a']);
  });

  it('places bodies in the lorebook slot, around the description, at named positions and injection targets, trying @@@ fallbacks', () => {
    const entries = [
      lore('slot', { constant: true, content: '@@role assistant\nslot' }),
      lore('before', { constant: true, position: 'before_char' }),
      lore('after', { constant: true, position: 'before_char', content: '@@position scenario\nafter' }),
      lore('named', { constant: true, content: '@@position pt_status\nnamed' }),
      lore('inject', { constant: true, content: '@@inject_at main\n@@inject_replace {{slot}}\ninject' }),
      lore('fallback', { constant: true, content: '@@role narrator\n@@@role user\n@@disable_ui_prompt\n@@@depth 1\nfallback' }),
    ];
    const result = run(entries, []);
    expect(Object.fromEntries(result.placed.map(({ id, body, placement }) => [id, { body, placement }]))).toEqual({
      slot: { body: 'slot', placement: { kind: 'lorebook', role: 'assistant' } },
      before: { body: 'before', placement: { kind: 'description', side: 'before' } },
      after: { body: 'after', placement: { kind: 'description', side: 'after' } },
      named: { body: 'named', placement: { kind: 'position', name: 'status' } },
      inject: { body: 'inject', placement: { kind: 'inject', target: 'main', operation: { kind: 'replace', find: '{{slot}}' } } },
      fallback: { body: 'fallback', placement: { kind: 'depth', depth: 1, role: 'user' } },
    });
  });

  it("counts depth from the end, @@reverse_depth too, keeps @@depth 0 and @@end for the end, and lists one place's entries in Risu's order (row 3)", () => {
    const entries = [
      lore('d1', { constant: true, insertionOrder: 1, content: '@@depth 2\nd1' }),
      lore('d2', { constant: true, insertionOrder: 2, content: '@@depth 2\nd2' }),
      lore('r1', { constant: true, insertionOrder: 3, content: '@@reverse_depth 2\nr1' }),
      lore('r2', { constant: true, insertionOrder: 4, content: '@@reverse_depth 2\nr2' }),
      lore('prefill', { constant: true, insertionOrder: 5, content: '@@depth 0\n@@role assistant\nprefill' }),
      lore('end', { constant: true, insertionOrder: 6, content: '@@end\nend' }),
      lore('r0', { constant: true, insertionOrder: 7, content: '@@reverse_depth 0\nr0' }),
    ];
    const result = run(entries, chat('hi'));
    expect(order(result)).toEqual(['r0', 'd2', 'd1', 'r1', 'r2', 'end', 'prefill']);
    expect(result.placed.map(({ placement }) => placement)).toEqual([
      { kind: 'depth', depth: 0, role: 'system' },
      ...Array.from({ length: 4 }, () => ({ kind: 'depth', depth: 2, role: 'system' })),
      { kind: 'end', role: 'system' },
      { kind: 'end', role: 'assistant' },
    ]);
  });

  it('merges @@inject_lore into the fired entry of that name, and reports one with no target or no text to replace', () => {
    const entries = [
      lore('target', { constant: true, name: 'Castle', content: 'The castle. [moat]' }),
      lore('add', { constant: true, insertionOrder: 1, content: '@@inject_lore Castle\nIt is old.' }),
      lore('swap', { constant: true, insertionOrder: 2, content: '@@inject_lore Castle\n@@inject_replace [moat]\nA moat.' }),
      lore('lost', { constant: true, content: '@@inject_lore Tower\nlost' }),
      lore('miss', { constant: true, insertionOrder: 3, content: '@@inject_lore Castle\n@@inject_replace [gate]\nmiss' }),
    ];
    const result = run(entries, []);
    expect(result.placed).toEqual([{ id: 'target', body: 'The castle. A moat. It is old.', placement: { kind: 'lorebook', role: 'system' } }]);
    expect(Object.fromEntries(result.fired.map(({ id, fate }) => [id, fate]))).toEqual({
      target: { kind: 'placed', tokens: 18 },
      add: { kind: 'merged', into: 'target', tokens: 10 },
      swap: { kind: 'merged', into: 'target', tokens: 7 },
      lost: { kind: 'dropped', cause: 'no-target', tokens: 4 },
      miss: { kind: 'dropped', cause: 'no-target', tokens: 4 },
    });
  });

  it('drops an @@inject_at entry whose target no text block of the prompt carries', () => {
    const result = run([lore('main', { constant: true, content: '@@inject_at main\nmain' }), lore('note', { constant: true, content: '@@inject_at globalNote\nnote' })], [], { marks: new Set(['main']) });
    expect(order(result)).toEqual(['main']);
    expect(result.fired.find(({ id }) => id === 'note')!.fate).toEqual({ kind: 'dropped', cause: 'no-block', target: 'globalNote', tokens: 4 });
  });
});
