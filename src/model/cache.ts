import type { ModelSettings } from '../connectors/settings';
import type { Cost } from '../connectors/types';
import type { Fired, Silent } from '../engine/lorebook/activate';
import type { Assembled, From } from '../engine/pipeline';
import { secondInverted } from './memory';
import type { PackOwner } from './library';
import type { Block, Role } from './prompt';

// Wire-order cache identity; tokens use o200k_base, an estimate for other tokenizers.
export type WireMessage = { role: Role; hash: string; tokens: number; from: From; point?: true };

// Last call that kept a cache, by its points or a prefix the provider caches on its own, in provider wire order
// (connectors/registry CacheView).
// One replaceable object per chat at cachePrintId(chat); account is null when unknown.
export type CachePrint = {
  call: string;
  connection: string;
  account: string | null;
  model: string;
  reasoning?: ModelSettings['reasoning'];
  messages: WireMessage[];
};

// far means the next point exceeds the provider's lookback from the last readable point.
export type CacheBreak =
  | { kind: 'model' | 'account' | 'reasoning' | 'off' | 'expired' | 'far' }
  | { kind: 'changed' | 'added' | 'removed' | 'moved'; from: From; role: Role };

// read: the tokens the send would read from the cache, of all the last call cached up to its last point. broken: the
// first reason in wire order, null when it reads all of it. Kept on the send's receipt (model/chat Receipt forecast).
export type CacheForecast = { read: number; of: number; broken: CacheBreak | null };

// The chat's id with its second group's hex digits inverted, as memoryId inverts the first and vectorsId the last.
export const cachePrintId = secondInverted;

// Wire order. tail is full-price text after the last caching point; short points cache nothing.
// before is the paired old position, null for additions and unchanged parts. again: the last call cached this text and
// this send pays for it in full.
export type ForecastPart = { role: Role; from: From; tokens: number; state: 'read' | 'write' | 'tail'; again: boolean; change: 'changed' | 'added' | 'moved' | null; before: number | null; point: 'cache' | 'short' | null };
// against is null without a prior call; written excludes the uncached tail. prefix: no point on either side, so the
// provider caches on its own, and writes nothing a forecast counts.
export type Forecast = {
  parts: ForecastPart[];
  removed: { role: Role; from: From; tokens: number; before: number }[];
  written: number;
  tail: number;
  against: CacheForecast | null;
  prefix: boolean;
};

// coarse keeps the complete differing middle, without claiming its internal alignment.
export type CacheDiff = { runs: { kind: 'same' | 'before' | 'after'; text: string }[]; coarse: boolean };
export type CacheCause =
  // script: the tag read a variable the bot's scripts write.
  | { kind: 'tag'; tag: string; before: string; after: string; script?: true }
  | { kind: 'lore'; id: string; name: string; before: CacheLore | null; after: CacheLore | null }
  | { kind: 'moved'; before: number; after: number; depth: number | null }
  // request: the bot's scripts rewrote the message as it was sent (editRequest). deleted, budget: a chat message left,
  // gone from the chat or dropped to fit the model. source: the part's own text was edited.
  | { kind: 'edited' | 'deleted' | 'budget' | 'source' | 'memory' | 'request' | 'unknown' };
export type CacheLore = { fired: true; why: Fired['why'] } | { fired: false; why: Silent['why'] };
// Positions address wire order. A null diff lacks text; an empty causes list lacks even a provable cause.
// unknown is reserved for text we compared but cannot attribute. missing counts the null diffs.
export type CacheDiagnosis = {
  parts: { kind: 'changed' | 'added' | 'removed' | 'moved'; from: From; role: Role; before: number | null; after: number | null; diff: CacheDiff | null; causes: CacheCause[] }[];
  missing: number;
};

export type CacheEdit =
  | { kind: 'prompt'; id: string; block: string; field: 'blocks'; before: Block[]; after: Block[] }
  | ({ kind: 'lore'; id: string; name: string } & (
    | { field: 'constant'; before: boolean; after: boolean }
    | { field: 'content'; before: string; after: string }
  ))
  // The value held for the character's chats, or with character null for 캐릭터 없이's; null holds none, and the
  // toggle reads its default. says: the option the new value names, null for a check.
  | { kind: 'toggle'; character: string | null; key: string; name: string; says: string | null; before: string | null; after: string | null }
  // A regex script stopped where it stands. pack: its pack's place among the chat's (ChatScope packs).
  | { kind: 'script'; owner: PackOwner; pack: number; id: string; name: string; before: boolean; after: boolean };

export type CacheCandidate = { cause: 'tag' | 'lore' | 'moved' | 'script'; action: 'after-chat' | 'before-chat' | 'constant' | 'toggle' | 'off'; edit: CacheEdit; from: From; role: Role };
export type CacheBreakCost = { paid: Cost; whole: Cost };
// Each price applies this edit alone against the same prior; prices cannot be added across prescriptions.
// turn: for an edit to where a part stands, which pays from the send after this one: what the send after reads of what
// this one caches, as it stands and with the edit. The messages to come are stood in for, so it prices the shape alone.
export type CacheTurn = Pick<CacheForecast, 'read' | 'of'> & { cost: CacheBreakCost | null };
export type CachePrescription = CacheCandidate & {
  before: Pick<CacheForecast, 'read' | 'of'>;
  after: Pick<CacheForecast, 'read' | 'of'>;
  cost: CacheBreakCost | null;
  turn: { before: CacheTurn; after: CacheTurn } | null;
};

// Latest ten distinct calls. Forecast breaks and reported shortfalls can count the same call.
// streak skips unjudged calls and stops at a connection change.
export type CacheRecurrence = { considered: number; missing: number; broken: number; short: number; causes: { cause: CacheBreak; count: number }[]; streak: { connection: string; count: number } | null };
// expected is calibrated to native counts when ratio is known; otherwise it remains the o200k estimate.
export type CacheShortfall = { expected: number; actual: number; ratio: number | null; short: boolean };

// Page memory only, alongside the request log; index is the prompt position, not the wire position.
export type CacheText = { content: string; index: number }[];

// rewritten: the prompt positions whose message the bot's scripts rewrote as it was sent.
export type CacheComparison = { forecast: Forecast; before: { prompt?: Assembled; wire?: CacheText } | null; after: { prompt: Assembled; wire: CacheText; rewritten?: number[] } };

// Diagnosis replays source, matching rendered to actual wire text; no per-send trace is stored.
// place pairs renders across sends by part id or `${id}:…` for split parts.
export type CacheRender = { place: string; text: string; rendered: string; seed: string; cast?: string };
