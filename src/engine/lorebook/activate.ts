import type { HistoryMessage } from '../history';
import type { Card, LoreEntry } from '../import/types';
import { progressed } from '../progress';
import { seeded } from '../random';
import { args, parseDecorators, type DecoratorLine } from './decorators';
import { compile, scan, type Matcher, type Scanned, type Source } from './keys';

type Role = 'system' | 'user' | 'assistant';

export type Operation = { kind: 'append' } | { kind: 'prepend' } | { kind: 'replace'; find: string };

export type Placement =
  | { kind: 'lorebook'; role: Role }
  | { kind: 'description'; side: 'before' | 'after' }
  // Counted from the end of the chat: 0 is after the last message.
  | { kind: 'depth'; depth: number; role: Role }
  | { kind: 'position'; name: string }
  | { kind: 'inject'; target: string; operation: Operation };

export type KeyMatch = { query: 'primary' | 'secondary' | 'additional'; key: string; source: Source };

export type Why = { kind: 'constant' } | { kind: 'decorator'; name: 'activate' | 'keep_activate_after_match' } | { kind: 'keys'; matched: KeyMatch[] };

// tokens: the cost of the entry's own body, before any merge.
export type Fate =
  | { kind: 'placed'; tokens: number }
  | { kind: 'merged'; into: string; tokens: number }
  | { kind: 'dropped'; cause: 'probability' }
  | { kind: 'dropped'; cause: 'budget' | 'no-target'; tokens: number }
  | { kind: 'dropped'; cause: 'no-block'; target: string; tokens: number };

export type Fired = { id: string; why: Why; fate: Fate };

// Report the first failed condition in activation order; only-after/every count Risu chatLength.
// keyless was scanned without keys; unmatched had keys but no hit.
type Closed = { kind: 'closed'; cause: 'disabled' | 'never' | 'after-match' | 'greeting' } | { kind: 'closed'; cause: 'only-after'; from: number } | { kind: 'closed'; cause: 'only-every'; every: number };
export type Silent = { id: string; why: Closed | { kind: 'keyless' } | { kind: 'unmatched' } };

// In lorebook order. The ids key the after-match state, so they must outlive the send.
export type LoreEntries = { id: string; value: Omit<LoreEntry, 'folder'> }[];

export type LoreTurn = {
  // Exclude the greeting from key scans. Risu chatLength is history.length + 1 regardless of greeting presence.
  history: HistoryMessage[];
  // The chat's greeting as an index into Card.greetings, which @@is_greeting counts from 1.
  greeting: number | null;
  // Entries with an after-match decorator that went into an earlier prompt of this chat, as the previous
  // Activation.afterMatch left them.
  afterMatch: readonly string[];
  seed: string;
  // What an entry's own body costs as the request sends it; the id is the entry's, which places its random tags.
  cost: (id: string, body: string) => number;
  // The marks the prompt's text blocks carry, where the pipeline merges @@inject_at entries: one naming any other goes nowhere.
  marks: ReadonlySet<string>;
};

export type Activation = {
  // Raw bodies, with the @@inject_lore entries merged in. Entries bound for one place are listed in the order
  // they go in there.
  placed: { id: string; body: string; placement: Placement }[];
  // Every entry that fired, in the order it fired, including those that did not go in.
  fired: Fired[];
  // Every entry that did not fire, in lorebook order.
  silent: Silent[];
  invalidKeys: { entry: string; key: string }[];
  afterMatch: string[];
};

// A chat's scan settings as they apply, none left open: the card's own over the account's (runtime/chat-context loreScanOf).
export type LoreScan = { [K in keyof Card['loreSettings']]: NonNullable<Card['loreSettings'][K]> };

type Where =
  | { kind: 'lorebook' }
  | { kind: 'description'; side: 'before' | 'after' }
  | { kind: 'depth'; depth: number; reverse: boolean }
  | { kind: 'position'; name: string }
  | { kind: 'inject'; target: string };

// Later decorators replace earlier ones of the same kind; placement kinds also replace one another.
type Rules = {
  trigger: 'keys' | 'activate' | 'never';
  afterMatch: 'keep' | 'dont' | null;
  onlyAfter: number;
  onlyEvery: number;
  greeting: number | null;
  probability: number;
  scanDepth: number | null;
  fullWord: boolean | null;
  priority: number;
  recursive: boolean | null;
  searchRecursion: boolean;
  additional: string[][];
  exclude: string[][];
  excludeAll: string[][];
  role: Role;
  where: Where;
  into: string | null;
  operation: Operation;
};

type Query = { key: string; match: Matcher }[];
type Evidence = Map<Matcher, Source>;

type Book = {
  id: string;
  value: Omit<LoreEntry, 'folder'>;
  body: string;
  scanned: Scanned;
  matchers: Matcher[];
  rules: Rules;
  queries: { primary: Query; secondary: Query; additional: Query[]; exclude: Query[]; excludeAll: Query[] };
};

const ROLES: readonly string[] = ['system', 'user', 'assistant'];
const SIDES = new Map<string, 'before' | 'after'>([
  ['before_desc', 'before'],
  ['after_desc', 'after'],
  ['personality', 'after'],
  ['scenario', 'after'],
]);
const NEVER: Matcher = () => false;

export type LoreBook = { sticky: boolean; activate: (input: LoreTurn) => Activation };

export function prepareLore(entries: LoreEntries, settings: LoreScan): LoreBook {
  const invalidKeys: Activation['invalidKeys'] = [];
  // A disabled entry stays an id, unprepared: its keys are neither compiled nor reported.
  const shelf = entries.map((entry) => (entry.value.enabled ? prepare(entry, settings.fullWordMatching, invalidKeys) : entry.id));
  const books = shelf.filter((entry) => typeof entry !== 'string');
  // A prepared book belongs to one replay; edits/settings changes start another and cannot reuse stale text.
  const scanned = new WeakMap<HistoryMessage, Scanned>();
  const window = (history: HistoryMessage[], depth: number) => {
    const messages: Scanned[] = [];
    for (let at = Math.max(history.length - depth, 0); at < history.length; at++) {
      const message = history[at]!;
      let text = scanned.get(message);
      if (!text) {
        text = scan({ kind: 'message', id: message.id }, message.text);
        scanned.set(message, text);
      }
      messages.push(text);
    }
    return messages;
  };
  return {
    sticky: books.some(({ rules }) => rules.trigger !== 'never' && rules.afterMatch !== null),
    activate: (input) => activate(shelf, books, settings, invalidKeys, window, input),
  };
}

function activate(shelf: (Book | string)[], books: Book[], { scanDepth, recursive, tokenBudget }: LoreScan, invalidKeys: Activation['invalidKeys'], window: (history: HistoryMessage[], depth: number) => Scanned[], { history, greeting, afterMatch: before, seed, cost, marks }: LoreTurn): Activation {
  const afterMatch = new Set(before);
  const chatLength = history.length + 1;

  const closed = ({ id, rules }: Book): Closed | null => {
    if (rules.trigger === 'never') return { kind: 'closed', cause: 'never' };
    if (rules.afterMatch === 'dont' && afterMatch.has(id)) return { kind: 'closed', cause: 'after-match' };
    if (chatLength < rules.onlyAfter) return { kind: 'closed', cause: 'only-after', from: rules.onlyAfter };
    if (chatLength % rules.onlyEvery !== 0) return { kind: 'closed', cause: 'only-every', every: rules.onlyEvery };
    if (rules.greeting !== null && (greeting === null || greeting + 1 !== rules.greeting)) return { kind: 'closed', cause: 'greeting' };
    return null;
  };
  const matched: { book: Book; why: Why }[] = [];
  const active: Book[] = [];
  const fates = new Map<string, Fate>();
  let waiting = books.filter((book) => closed(book) === null).map((book) => ({ book, evidence: new Map<Matcher, Source>() }));
  let frontier: Scanned[] = [];
  let first = true;
  // Scan prior passes' activated text. Each entry fires at most once and retains its roll across passes.
  for (;;) {
    const waited = waiting;
    const now: Book[] = [];
    waiting = [];
    for (const pending of waited) {
      progressed();
      const { book, evidence } = pending;
      const why = triggered(book, afterMatch, () => {
        if (first) consume(book.matchers, evidence, window(history, book.rules.scanDepth ?? scanDepth));
        if (book.rules.searchRecursion) consume(book.matchers, evidence, frontier);
        return evidence;
      });
      if (!why) {
        waiting.push(pending);
        continue;
      }
      matched.push({ book, why });
      if (seeded(`${seed}:${book.id}`)() * 100 < book.rules.probability) now.push(book);
      else fates.set(book.id, { kind: 'dropped', cause: 'probability' });
    }
    active.push(...now);
    const bodies = now.filter(({ rules }) => rules.recursive ?? recursive).map(({ scanned }) => scanned);
    if (bodies.length === 0) break;
    frontier = bodies;
    first = false;
  }

  // Risu's budget and order (risu-compat-spec §b Budget, ordering, output), step by step: the stable sorts and
  // the final reverse decide where ties land.
  const tokens = new Map(active.map(({ id, body }) => [id, cost(id, body)]));
  let left = tokenBudget;
  const kept: Book[] = [];
  for (const book of [...active].sort((a, b) => b.rules.priority - a.rules.priority)) {
    const cost = tokens.get(book.id)!;
    if (cost > left) {
      fates.set(book.id, { kind: 'dropped', cause: 'budget', tokens: cost });
      continue;
    }
    left -= cost;
    kept.push(book);
  }
  kept.sort((a, b) => b.value.insertionOrder - a.value.insertionOrder);
  const bodies = new Map(kept.map(({ id, body }) => [id, body]));
  const stays = kept.filter(({ id, rules: { into, where } }) => {
    if (into !== null) return false;
    if (where.kind !== 'inject' || marks.has(where.target)) return true;
    fates.set(id, { kind: 'dropped', cause: 'no-block', target: where.target, tokens: tokens.get(id)! });
    return false;
  });
  for (const book of kept) {
    if (book.rules.into === null) continue;
    const target = stays.find(({ value }) => value.name === book.rules.into);
    const body = target ? merge(bodies.get(target.id)!, book.body, book.rules.operation) : null;
    const cost = tokens.get(book.id)!;
    if (target && body !== null) {
      bodies.set(target.id, body);
      fates.set(book.id, { kind: 'merged', into: target.id, tokens: cost });
    } else fates.set(book.id, { kind: 'dropped', cause: 'no-target', tokens: cost });
  }
  const final = stays.reverse();
  for (const { id } of final) fates.set(id, { kind: 'placed', tokens: tokens.get(id)! });

  const ranked = final.map((book, index) => ({ book, rank: depthRank(book.rules, index) }));
  const placed = [...ranked.filter(({ rank }) => rank.length === 0), ...ranked.filter(({ rank }) => rank.length > 0).sort((a, b) => compare(a.rank, b.rank))];
  const unmatched = new Set(waiting.map(({ book }) => book));
  const silent = shelf.flatMap((entry): Silent[] => {
    if (typeof entry === 'string') return [{ id: entry, why: { kind: 'closed', cause: 'disabled' } }];
    const why = closed(entry) ?? (unmatched.has(entry) ? { kind: entry.queries.primary.length === 0 ? 'keyless' : 'unmatched' } : null);
    return why ? [{ id: entry.id, why }] : [];
  });
  const went = kept.filter(({ id, rules }) => rules.afterMatch !== null && fates.get(id)!.kind !== 'dropped').map(({ id }) => id);
  return {
    placed: placed.map(({ book }) => ({ id: book.id, body: bodies.get(book.id)!, placement: placement(book.rules) })),
    fired: matched.map(({ book, why }) => ({ id: book.id, why, fate: fates.get(book.id)! })),
    silent,
    invalidKeys,
    afterMatch: [...new Set([...before, ...went])],
  };
}

function prepare({ id, value }: LoreEntries[number], fullWordMatching: boolean, invalidKeys: Activation['invalidKeys']): Book {
  const { decorators, body } = parseDecorators(value.content);
  const rules: Rules = {
    trigger: 'keys',
    afterMatch: null,
    onlyAfter: 0,
    onlyEvery: 1,
    greeting: null,
    probability: 100,
    scanDepth: null,
    fullWord: null,
    // CCv3 defines priority and position, which Risu drops; CCv3 wins.
    priority: value.priority ?? value.insertionOrder,
    recursive: null,
    searchRecursion: true,
    additional: [],
    exclude: [],
    excludeAll: [],
    role: 'system',
    // before_char and after_char: the character's definitions are what the description slot holds.
    where: value.position === null ? { kind: 'lorebook' } : { kind: 'description', side: value.position === 'before_char' ? 'before' : 'after' },
    into: null,
    operation: { kind: 'append' },
  };
  for (const decorator of decorators) {
    if (!apply(rules, decorator)) decorator.fallbacks.some((fallback) => apply(rules, fallback));
  }
  const mode = { regex: value.useRegex, caseSensitive: value.caseSensitive, fullWord: rules.fullWord ?? fullWordMatching };
  const query = (keys: string[]): Query =>
    keys
      .map((key) => key.trim())
      .filter((key) => key !== '')
      .map((key) => {
        const match = compile(key, mode);
        if (!match) invalidKeys.push({ entry: id, key });
        // A key that does not compile never matches, so it cannot complete an @@exclude_keys_all either.
        return { key, match: match ?? NEVER };
      });
  const queries = {
    primary: query(value.keys),
    secondary: value.selective ? query(value.secondaryKeys) : [],
    additional: rules.additional.map(query),
    exclude: rules.exclude.map(query),
    excludeAll: rules.excludeAll.map(query),
  };
  return {
    id,
    value,
    body,
    scanned: scan({ kind: 'entry', id }, body),
    rules,
    queries,
    matchers: [queries.primary, queries.secondary, ...queries.additional, ...queries.exclude, ...queries.excludeAll].flat().map(({ match }) => match),
  };
}

const integer = (value: string, min: number) => {
  const number = Number(value);
  return value !== '' && Number.isInteger(number) && number >= min ? number : null;
};
const finite = (value: string) => {
  const number = Number(value);
  return value !== '' && Number.isFinite(number) ? number : null;
};

// false when the decorator is not handled, so its @@@ fallbacks are tried: unknown names, invalid arguments,
// and @@disable_ui_prompt, which risu-alpha does not implement.
function apply(rules: Rules, { name, value }: DecoratorLine): boolean {
  switch (name) {
    case 'depth':
    case 'reverse_depth': {
      const depth = integer(value, 0);
      if (depth === null) return false;
      rules.where = { kind: 'depth', depth, reverse: name === 'reverse_depth' };
      return true;
    }
    case 'end':
      rules.where = { kind: 'depth', depth: 0, reverse: false };
      return true;
    case 'role':
      if (!ROLES.includes(value)) return false;
      rules.role = value as Role;
      return true;
    case 'position': {
      const side = SIDES.get(value);
      if (side) rules.where = { kind: 'description', side };
      else if (value.startsWith('pt_')) rules.where = { kind: 'position', name: value.slice(3) };
      else return false;
      return true;
    }
    case 'inject_at':
      if (value === '') return false;
      rules.where = { kind: 'inject', target: value };
      return true;
    case 'inject_lore':
      if (value === '') return false;
      rules.into = value;
      return true;
    // Its argument is not read: the spec gives prepend's parameter no meaning.
    case 'inject_prepend':
      rules.operation = { kind: 'prepend' };
      return true;
    case 'inject_replace':
      if (value === '') return false;
      rules.operation = { kind: 'replace', find: value };
      return true;
    case 'scan_depth':
    case 'activate_only_after':
    case 'activate_only_every':
    case 'is_greeting': {
      const number = integer(value, name === 'scan_depth' || name === 'activate_only_after' ? 0 : 1);
      if (number === null) return false;
      if (name === 'scan_depth') rules.scanDepth = number;
      else if (name === 'activate_only_after') rules.onlyAfter = number;
      else if (name === 'activate_only_every') rules.onlyEvery = number;
      else rules.greeting = number;
      return true;
    }
    case 'probability':
    case 'priority': {
      const number = finite(value);
      if (number === null) return false;
      if (name === 'probability') rules.probability = number;
      else rules.priority = number;
      return true;
    }
    case 'ignore_on_max_context':
      rules.priority = -1000;
      return true;
    // Like constant: the keys are not searched, and the turn, greeting and probability conditions still apply.
    case 'activate':
      rules.trigger = 'activate';
      return true;
    case 'dont_activate':
      rules.trigger = 'never';
      return true;
    // Per entry: the flag lives in this entry's rules, and the state is keyed by its id.
    case 'keep_activate_after_match':
    case 'dont_activate_after_match':
      rules.afterMatch = name === 'keep_activate_after_match' ? 'keep' : 'dont';
      return true;
    case 'additional_keys':
    case 'exclude_keys':
    case 'exclude_keys_all': {
      const keys = args(value);
      if (keys.length === 0) return false;
      (name === 'additional_keys' ? rules.additional : name === 'exclude_keys' ? rules.exclude : rules.excludeAll).push(keys);
      return true;
    }
    case 'match_full_word':
    case 'match_partial_word':
      rules.fullWord = name === 'match_full_word';
      return true;
    case 'recursive':
    case 'unrecursive':
      rules.recursive = name === 'recursive';
      return true;
    case 'no_recursive_search':
      rules.searchRecursion = false;
      return true;
    default:
      return false;
  }
}

function triggered({ id, value, rules, queries }: Book, afterMatch: ReadonlySet<string>, readEvidence: () => Evidence): Why | null {
  if (value.constant) return { kind: 'constant' };
  if (rules.trigger === 'activate') return { kind: 'decorator', name: 'activate' };
  if (rules.afterMatch === 'keep' && afterMatch.has(id)) return { kind: 'decorator', name: 'keep_activate_after_match' };
  const evidence = readEvidence();
  const matched: KeyMatch[] = [];
  const needs = (query: Query, name: KeyMatch['query']) => {
    const hit = find(query, evidence);
    if (hit) matched.push({ query: name, ...hit });
    return hit !== null;
  };
  if (!needs(queries.primary, 'primary')) return null;
  if (queries.secondary.length > 0 && !needs(queries.secondary, 'secondary')) return null;
  if (!queries.additional.every((query) => needs(query, 'additional'))) return null;
  if (queries.exclude.some((query) => find(query, evidence))) return null;
  // Every key somewhere in the scanned text, not every key in every message.
  if (queries.excludeAll.some((query) => query.every(({ match }) => evidence.has(match)))) return null;
  return { kind: 'keys', matched };
}

function consume(matchers: Matcher[], evidence: Evidence, sources: Scanned[]) {
  for (const match of matchers) {
    if (evidence.has(match)) continue;
    const scanned = sources.find(match);
    if (scanned) evidence.set(match, scanned.source);
  }
}

function find(query: Query, evidence: Evidence): { key: string; source: Source } | null {
  // Key order outranks source age: a higher-priority key can first match in a later frontier.
  for (const { key, match } of query) {
    const source = evidence.get(match);
    if (source) return { key, source };
  }
  return null;
}

// null: the text a replace looks for is not in the target.
export function merge(target: string, body: string, operation: Operation): string | null {
  switch (operation.kind) {
    case 'append':
      return `${target} ${body}`;
    case 'prepend':
      return `${body} ${target}`;
    case 'replace':
      return target.includes(operation.find) ? target.replace(operation.find, () => body) : null;
  }
}

function placement({ where, role, operation }: Rules): Placement {
  switch (where.kind) {
    case 'lorebook':
      return { kind: 'lorebook', role };
    case 'depth':
      return { kind: 'depth', depth: where.depth, role };
    case 'inject':
      return { kind: 'inject', target: where.target, operation };
    default:
      return where;
  }
}

// Preserve Risu ties (§e steps 7/14): at depth >0 reverse @@depth, then keep @@reverse_depth order.
// At 0 put reverse-depth first, then depth in order with assistant entries last; elsewhere return empty.
function depthRank({ where, role }: Rules, index: number): number[] {
  if (where.kind !== 'depth') return [];
  if (where.depth > 0) return where.reverse ? [where.depth, 1, index] : [where.depth, 0, -index];
  return [0, where.reverse ? 0 : role === 'assistant' ? 2 : 1, index];
}

const compare = (a: number[], b: number[]) => a.reduce((result, value, i) => result || value - b[i]!, 0);
