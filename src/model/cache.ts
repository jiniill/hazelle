import type { ModelSettings } from '../connectors/settings';
import type { Cost } from '../connectors/types';
import type { Fired, Silent } from '../engine/lorebook/activate';
import type { Assembled, From } from '../engine/pipeline';
import { inverted } from './memory';
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
export const cachePrintId = (chat: string) => chat.replace(/^([0-9a-f]{8}-)([0-9a-f]{4})/, (_, head: string, group: string) => head + inverted(group));

// Wire order. tail is full-price text after the last caching point; short points cache nothing.
// before is the paired old position, null for additions and unchanged parts.
export type ForecastPart = { role: Role; from: From; tokens: number; state: 'read' | 'write' | 'tail'; change: 'changed' | 'added' | 'moved' | null; before: number | null; point: 'cache' | 'short' | null };
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
  | { kind: 'tag'; tag: string; before: string; after: string }
  | { kind: 'lore'; id: string; name: string; before: CacheLore | null; after: CacheLore | null }
  | { kind: 'moved'; before: number; after: number; depth: number | null }
  | { kind: 'hoisted'; wire: number; prompt: number }
  | { kind: 'edited' | 'memory' | 'unknown' };
export type CacheLore = { fired: true; why: Fired['why'] } | { fired: false; why: Silent['why'] };
// Positions address wire order. A null diff lacks text; an empty causes list lacks even a provable cause.
// unknown is reserved for text we compared but cannot attribute. missing counts the null diffs.
export type CacheDiagnosis = {
  parts: { kind: 'changed' | 'added' | 'removed' | 'moved'; from: From; role: Role; before: number | null; after: number | null; diff: CacheDiff | null; causes: CacheCause[] }[];
  missing: number;
};

export type CacheEdit =
  | ({ kind: 'prompt'; id: string; block: string } & (
    | { field: 'blocks'; before: Block[]; after: Block[] }
    | { field: 'role'; before: Role; after: Role }
  ))
  | ({ kind: 'lore'; id: string; name: string } & (
    | { field: 'constant'; before: boolean; after: boolean }
    | { field: 'content'; before: string; after: string }
  ));

export type CacheCandidate = { cause: 'tag' | 'lore' | 'hoisted'; action: 'after-chat' | 'constant' | 'user-role'; edit: CacheEdit; from: From; role: Role };
export type CacheBreakCost = { paid: Cost; whole: Cost };
// Each price applies this edit alone against the same prior; prices cannot be added across prescriptions.
export type CachePrescription = CacheCandidate & {
  before: Pick<CacheForecast, 'read' | 'of'>;
  after: Pick<CacheForecast, 'read' | 'of'>;
  cost: CacheBreakCost | null;
};

// Latest ten distinct calls. Forecast breaks and reported shortfalls can count the same call.
// streak skips unjudged calls and stops at a connection change.
export type CacheRecurrence = { considered: number; missing: number; broken: number; short: number; causes: { cause: CacheBreak; count: number }[]; streak: { connection: string; count: number } | null };
// expected is calibrated to native counts when ratio is known; otherwise it remains the o200k estimate.
export type CacheShortfall = { expected: number; actual: number; ratio: number | null; short: boolean };

// Page memory only, alongside the request log; index is the prompt position, not the wire position.
export type CacheText = { content: string; index: number }[];

export type CacheComparison = { forecast: Forecast; before: { prompt?: Assembled; wire?: CacheText } | null; after: { prompt: Assembled; wire: CacheText } };

// Diagnosis replays source, matching rendered to actual wire text; no per-send trace is stored.
// place pairs renders across sends by part id or `${id}:…` for split parts.
export type CacheRender = { place: string; text: string; rendered: string; seed: string; cast?: string };
