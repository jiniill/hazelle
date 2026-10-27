import type { ModelSettings } from '../connectors/settings';
import type { Cost } from '../connectors/types';
import type { Fired, Silent } from '../engine/lorebook/activate';
import type { Assembled, From } from '../engine/pipeline';
import { inverted } from './memory';
import type { Block, Role } from './prompt';

// One message as the provider's cache reads it: hash of its role and content, its tokens as the prompt counted them
// (o200k_base, an estimate for any other tokenizer), where the prompt took it from, and whether a cache point ends it.
export type WireMessage = { role: Role; hash: string; tokens: number; from: From; point?: true };

// The chat's last reply call that sent a cache point, as the provider's cache reads it: messages in wire order
// (connectors/registry CacheView). One object per chat at cachePrintId(chat), parent the chat, replaced by each such
// call. account: the connection's account that served it; null where unknown.
export type CachePrint = {
  call: string;
  connection: string;
  account: string | null;
  model: string;
  reasoning?: ModelSettings['reasoning'];
  messages: WireMessage[];
};

// Why a send reads less than the last call cached. expired: the last call's TTL ran out. far: the next point lies
// past the provider's lookback from the last point it could read. changed, added, removed, moved: a message of the prompt.
export type CacheBreak =
  | { kind: 'model' | 'account' | 'reasoning' | 'off' | 'expired' | 'far' }
  | { kind: 'changed' | 'added' | 'removed' | 'moved'; from: From; role: Role };

// read: the tokens the send would read from the cache, of all the last call cached up to its last point. broken: the
// first reason in wire order, null when it reads all of it. Kept on the send's receipt (model/chat Receipt forecast).
export type CacheForecast = { read: number; of: number; broken: CacheBreak | null };

// The chat's id with its second group's hex digits inverted, as memoryId inverts the first and vectorsId the last.
export const cachePrintId = (chat: string) => chat.replace(/^([0-9a-f]{8}-)([0-9a-f]{4})/, (_, head: string, group: string) => head + inverted(group));

// Each message of the next send in wire order. read: the cache reads it. write: the send caches it for the next.
// tail: after the last point that caches, sent at the full price every time. change: how it differs from the last call.
// point: a point ends it, short when the prompt up to it is under the model's minimum and caches nothing.
// before: the paired old wire position for a change, null for an addition or an unchanged part.
export type ForecastPart = { role: Role; from: From; tokens: number; state: 'read' | 'write' | 'tail'; change: 'changed' | 'added' | 'moved' | null; before: number | null; point: 'cache' | 'short' | null };
// against: compared with the last call, null without one. removed: what the last call sent and the next does not.
// written: tokens the send caches anew; tail: those after its last caching point.
export type Forecast = {
  parts: ForecastPart[];
  removed: { role: Role; from: From; tokens: number; before: number }[];
  written: number;
  tail: number;
  against: CacheForecast | null;
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

// from, role: the broken part it mends.
export type CacheCandidate = { cause: 'tag' | 'lore' | 'hoisted'; action: 'after-chat' | 'constant' | 'user-role'; edit: CacheEdit; from: From; role: Role };
export type CacheBreakCost = { paid: Cost; whole: Cost };
// Each price applies this edit alone against the same prior; prices cannot be added across prescriptions.
export type CachePrescription = CacheCandidate & {
  before: Pick<CacheForecast, 'read' | 'of'>;
  after: Pick<CacheForecast, 'read' | 'of'>;
  cost: CacheBreakCost | null;
};

// The latest ten distinct reply calls: considered have forecasts, missing do not. broken: those that read less than the
// last call cached, as forecast (causes, the first break only being stored) or as the provider reported (short, read
// under the forecast; a reply can be both). streak: the newest run of shortfalls on one connection, unjudged replies skipped.
export type CacheRecurrence = { considered: number; missing: number; broken: number; short: number; causes: { cause: CacheBreak; count: number }[]; streak: { connection: string; count: number } | null };
// expected is calibrated to native counts when ratio is known; otherwise it remains the o200k estimate.
export type CacheShortfall = { expected: number; actual: number; ratio: number | null; short: boolean };

// Page memory only, alongside the request log; index is the prompt position, not the wire position.
export type CacheText = { content: string; index: number }[];

export type CacheComparison = { forecast: Forecast; before: { prompt?: Assembled; wire?: CacheText } | null; after: { prompt: Assembled; wire: CacheText } };

// No trace is kept per send. A diagnosis replays this source and must match rendered to the actual wire text. place
// pairs a render across sends: a part's own id, or `${id}:…` for a piece of it (the description block's per-character texts).
export type CacheRender = { place: string; text: string; rendered: string; seed: string; cast?: string };
