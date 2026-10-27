import type { CallCalibration } from './token-calibration';
import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Cache } from '../connectors/settings';
import type { Cost, Usage } from '../connectors/types';
import type { CacheForecast } from './cache';
import type { FeatureSwitches } from './features';
import type { Kind, Stored } from './kinds';
import type { LoreFolder, Mark } from './library';
import type { MemorySettings } from './memory';
import type { AgentStage } from './prompt';
import type { Card } from '../engine/import/types';
import type { UsageCall } from './usage';

export type Chat = Mark & {
  // null until the user names the chat; until then it is called by its first message, or a branch after its
  // origin (chatTitle).
  title: string | null;
  // A chat with no character talks to the model as it is.
  character: string | null;
  models: Assignment;
  // Each absent follows the default.
  prompt?: string;
  // 캐릭터 없이 only: set by a pick in its prompt picker, absent while it reads 프롬프트 없이 (keepsPromptOut).
  sendsPrompt?: true;
  persona?: string;
  note?: string;
  // 삽화 노트, sent to the scene writer through the 삽화 prompt's slot; absent is none.
  illustrateNote?: string;
  // Named as it was then so a renamed or deleted one still reads.
  origin?: { id: string; name: string; after: string };
  // A branch keeps its original's, so the history it copied reads the same.
  seed?: string;
  memory?: MemorySettings;
  // The variables it starts from, over the card's defaults: a chat brought from Risu keeps Risu's.
  variables?: [string, string][];
  // 등장인물 (design §6.9): characters whose description, lorebook and pictures join the chat's, in the order added, never
  // the chat's own. One gone or in 휴지통 reads as absent.
  cast?: string[];
  // 북마크, by message, in the order marked. One whose message is deleted or on no version's line stays stored and reads
  // as absent (app/chat/bookmarks bookmarkRows), so 되돌리기 of a deletion brings it back.
  bookmarks?: Bookmark[];
  // 채팅 로어북's folders, which only group its lorebook on screen.
  loreFolders?: LoreFolder[];
  // 기능, over its character's (runtime/features).
  features?: FeatureSwitches;
  // 에이전트, stacked after its character's (runtime/agents agentsOf).
  agents?: string[];
  // 옮겨 온 그림도 보내기: the inlays brought with it from Risu go to a model that sees pictures, as the ones attached here
  // always do (model/library Inlay).
  movedPictures?: true;
};

// Risu's 유틸리티 봇: a card made for a task, not a role, keeps the prompt's blocks and the persona out, and so does a chat
// with no character until one is picked in it (engine/pipeline UTILITY).
export const keepsPromptOut = (card: Pick<Card, 'utility'> | null, chat: Pick<Chat, 'sendsPrompt'>) => (card ? card.utility : !chat.sendsPrompt);

// name: only one the user gave.
export type Bookmark = { message: string; name?: string };

export const CAST_MAX = 5;

// The raw request is never stored.
export type Receipt = {
  calibration?: CallCalibration;
  // The call's own id (runtime/streams newCall, pageCall), the same in every copy of the receipt: an edit, a branch's
  // copy and a continued reply keep the receipt whole, and the call's ledger row is named by it (runtime/usage ledgerId).
  id: string;
  connection: string;
  // The id of the connection's account that served it; absent on a receipt older than accounts, and on a call picked
  // up after a reload.
  account?: string;
  // How many times it was sent, where a try failed before any of it came and was sent again (retry on failure); absent
  // for one try, and where it is not known.
  tries?: number;
  // The connection's and the model's names when the reply was made; either may be renamed or deleted later.
  source: string;
  // The provider's model id and the catalog's name; entry: the key of the further copy the call went through (connectors
  // Starred entry), absent for a model's first entry. 최근 and a resumed stream route by the key (callRef); usage and the
  // ledger group by model, so the copies count as one model.
  model: string;
  modelName: string;
  entry?: string;
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | 'refused' | null;
  error: ReceiptError | null;
  finishReason: string | null;
  usage: Usage | null;
  // pending until a `cost` entry for replyId arrives.
  cost: Cost | 'pending' | null;
  replyId: string | null;
  firstTextMs: number | null;
  totalMs: number;
  // How long the call's cache points keep what they cache, measured from its start; null when it sent none, or its
  // request was not this page's.
  cache: Cache | null;
  // What the send expected to read from the cache, against the chat's last call (runtime/cache); absent where that
  // call's request was not known, as on a receipt older than it.
  forecast?: CacheForecast;
  // The discount lane that served the call (design §6.7 할인 받기), as the provider reported it, and so priced; absent
  // when none did. tier: the same call at a slower service tier; batch: the whole reply submitted and waited for.
  discount?: 'tier' | 'batch';
  // PDF로 보내기 sent the earlier conversation as a PDF; absent when it did not, or the request was not this page's.
  pdf?: true;
  // 토큰 절약: the 보조 call whose brief shortened the request, the o200k count of what the brief stood in for in it
  // (material) and of the brief, and what that saved at the chat model's price when it was sent (engine/preread
  // savedCost; null where unknown). reused: a brief an earlier reply's call made, which this reply paid nothing for.
  // Never among calls(): that call made no part of the reply's text.
  preread?: { material: number; brief: number; receipt: Receipt; reused?: true; saved: Cost | null };
  // 에이전트: each agent's call for this reply, pre ones in their stacked order, then post ones in the order they ran.
  // Never among calls(), as preread's: each call's ledger row is written when it is made (runtime/agents).
  agents?: AgentRun[];
  // 이어 쓰기: the receipt of the reply this one continued, as it read then, so every call and its cost stays
  // visible after the continued version replaces the cut one. It nests when a continuation is continued again.
  continues?: Receipt;
};

// One agent's call for a reply (design §6.16), named as the agent was then. note: what a pre agent left for the reply.
// memory: the agent's state after the call, absent for one that keeps none. reused: a pre agent's note and state from
// the version this reply took the place of or was made beside (다시 시도, 다시 생성), which this reply paid nothing for.
export type AgentRun = { agent: string; name: string; stage: AgentStage; receipt: Receipt; note?: string; memory?: string; reused?: true };

// A receipt's own copy of runtime/generate ReplyError, converted where the receipt is written, so a
// change to the network's failure types never changes what saved chats hold. A stop is a cut, never
// an error. status is there when the provider refused the request, and absent when its stream failed.
export type ReceiptError =
  | { kind: 'refused'; code: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'provider'; status: number; detail: string }
  | { kind: 'provider'; detail: string }
  | { kind: 'bad-event'; detail: string }
  | { kind: 'network'; detail: string }
  | { kind: 'offline' }
  | { kind: 'no-token' }
  | { kind: 'pool'; group: string };

// A version as the reader reads it, beside its text, which is what the model is sent and never this.
// A version's is translated from its displayed text; a message sent translated keeps here what the user typed, and
// its text is the translation sent. receipt: the call that translated, null when the user wrote it in an edit. sentIn:
// the language a message sent translated went out in, as the English name its prompt read, and the one mark of such a
// message: any other translation, a user message's translated after it was sent among them, has none.
export type Translation = { text: string; receipt: Receipt | null; at: number; sentIn?: string };

// Shared by every chat, or a character's own (Character.ownTranslate): replies translates each chat's latest reply, reverse (반전 모드) sends the
// model each version's translation in place of its text. replyLanguage and inputLanguage are what replies and the
// user's messages are translated into, each as the English name the prompt reads. original (원문 함께 보기) shows each
// translated paragraph with its original under it. Absent fields are read through runtime/characters
// translateSwitches, the one place that knows their defaults.
export type TranslateSwitches = { replies: boolean; input: boolean; reverse?: boolean; original?: boolean; replyLanguage?: string; inputLanguage?: string; prompt?: string };

// Chat entries are created and never changed: an edit, a swipe or a deletion is a new
// entry. at is the writer's clock, for showing times only; order is the server's rev.
// seed: the id a version's random tags roll from in place of its own. A branch's copy keeps its original's, and
// an edit or a continued cut keeps the seed of the version it replaces, so text already shown never rolls again.
// staged: text already past the bot's input or output scripts (a message brought from Risu, one the bot's Lua
// wrote), which never run on it again; an edit of it is the same.
// before: the variables the bot's Lua wrote on the way to this version (when the message was sent, before its reply
// was made), which the chat's replay sets before the version's own text is read. An edit keeps those of the version
// it changes and adds its own.
// reasoning: what the model thought before it wrote the version, as its provider sent it or as Risu kept it. It is
// never part of text, so it is neither drawn in the story nor sent again; 응답 정보 is its one reader.
// greeting: the original card index, not a version's position or a text match. Edits and branches keep it.
// raw: the reply as written before its post agents rewrote it (design §6.16), which 원문 보기 shows; an edit keeps it.
export type Entry =
  // A new message with its first version, which has the entry's id. follows: the version of the message it continues,
  // by any id that version stood under, so each version of a message has its own continuation (ChatFold); null for
  // the first message of its line. Absent on a message saved before 2026-10-11, which continues the message before it in
  // rev order, through every version of that message saved before it.
  | { type: 'message'; role: 'user' | 'assistant'; at: number; text: string; receipt: Receipt | null; follows?: string | null; seed?: string; translation?: Translation; staged?: true; before?: Writes; reasoning?: string; greeting?: number; raw?: string }
  // replaces: the version this one takes the place of, for an edit, a retried failure or a continued cut
  // (이어 쓰기), so the count of versions does not grow; null for a new version, which goes last. An edit keeps
  // the receipt of the reply it changes.
  | { type: 'version'; message: string; replaces: string | null; edit: boolean; at: number; text: string; receipt: Receipt | null; seed?: string; translation?: Translation; staged?: true; before?: Writes; reasoning?: string; greeting?: number; raw?: string }
  | { type: 'select'; message: string; version: string; at: number }
  | { type: 'delete'; message: string; at: number }
  | { type: 'restore'; message: string; at: number }
  // A cost the provider booked after the reply, for every receipt with this replyId, those a continued reply
  // carries and translations' included.
  | { type: 'cost'; replyId: string; cost: Cost | null; at: number }
  // A translation made after the version was saved; the latest one for a version is its translation.
  | ({ type: 'translation'; version: string } & Translation)
  // The variables the bot's Lua wrote once the version stood, which the replay sets after the version's own text is
  // read. What the reply's end wrote follows the version into its edits and no further: a retried, continued or new
  // reply runs the bot's Lua again. stays: what a button wrote is the user's own act at that place in the story, so
  // it stays with the message whichever version is shown, and moves to the message before when its own is deleted.
  // byHand: the user's own value typed in 점검 › 변수, held by the version (Version byHand), never with stays.
  | { type: 'vars'; version: string; set: Writes; at: number; stays?: true; byHand?: true }
  // The message now continues follows instead: a bot's insertChat puts a new message ahead of one already saved, so
  // this one names a version saved after it. The latest one stands; one that would loop a line is passed over.
  | { type: 'follow'; message: string; follows: string; at: number }
  // A model call the bot's Lua made (LLM, axLLM) while version was the last one shown, kept so usage and cost count
  // it. It follows the version as vars does.
  | { type: 'call'; version: string; receipt: Receipt; at: number }
  // An agent's memory as the user set it at this version, over what the agent's call left there (Version memories).
  | { type: 'agentMemory'; version: string; agent: string; memory: string; at: number };

// Variable writes in the order made; a later one of a name wins.
export type Writes = [string, string][];

// earlier: the ids it stood under before its edits, oldest first; a retry, a continuation or a new version has none.
// byHand: the user's own writes (Entry vars byHand), set after the message's after, so they win over every write
// standing with the message; every reader takes this order (runtime/chat-context scopeOf, engine/render renderChat).
// memories: the agents' memory the user set at this version, by agent (Entry agentMemory), the latest standing.
// retouched: an edit of a polished version that changed its text, which 다시 다듬기 (from raw) would undo, so it is not
// offered there (user ruling, 2026-10-22).
export type Version = { id: string; seed: string; text: string; receipt: Receipt | null; edited: boolean; at: number; translation?: Translation; staged?: true; before?: Writes; after?: Writes; byHand?: Writes; calls?: BotCall[]; reasoning?: string; greeting?: number; earlier?: string[]; raw?: string; memories?: Record<string, string>; retouched?: true };
export type BotCall = { receipt: Receipt; at: number };
// after: the writes that stay with the message (Entry vars), set after its shown version's own.
export type Message = { id: string; role: 'user' | 'assistant'; at: number; versions: Version[]; selected: number; after?: Writes };

const versionOf = (id: string, entry: Extract<Entry, { type: 'message' | 'version' }>, edited: boolean, staged: boolean): Version => ({
  id,
  seed: entry.seed ?? id,
  text: entry.text,
  receipt: entry.receipt,
  edited,
  at: entry.at,
  ...(entry.translation && { translation: entry.translation }),
  ...(staged && { staged: true }),
  ...(entry.before && { before: entry.before }),
  ...(entry.reasoning && { reasoning: entry.reasoning }),
  ...(entry.greeting !== undefined && { greeting: entry.greeting }),
  ...(entry.raw !== undefined && { raw: entry.raw }),
});

type Order = { rev: number; pending?: number };

// Entries naming a message or version that is not there yet are skipped, even if it appears later in the replay.
// places: every id a version stood under, by its slot. founded: by message, the order of the entry that made each slot,
// never of an edit or retry that replaced it.
function replay(entries: Stored<'entry'>[]): { messages: Message[]; deleted: Set<string>; places: Map<string, number>; founded: Map<string, Order[]> } {
  const messages = new Map<string, Message>();
  const deleted = new Set<string>();
  // By a version's own id only: a translation of a replaced version is not its replacement's.
  const own = new Map<string, Version>();
  // A place never moves, so a replaced version's id keeps leading to whichever version stands there now, however many
  // times it was replaced since.
  const places = new Map<string, number>();
  const edits = new Map<string, Version>();
  const ids = new Map<Version, string[]>();
  const home = new Map<Version, Message>();
  const stand = (id: string, version: Version, earlier: string[] = []) => {
    ids.set(version, [...earlier, id]);
    for (const each of ids.get(version)!) edits.set(each, version);
  };
  const costs = new Map<string, Cost | null>();
  const founded = new Map<string, Order[]>();
  const locate = (message: Message, id: string) => {
    const version = own.get(id);
    return version && home.get(version) === message ? places.get(id)! : -1;
  };

  for (const { id, value: entry, rev, pending } of [...entries].sort(entryOrder)) {
    if (entry.type === 'message') {
      const version = versionOf(id, entry, false, entry.staged === true);
      own.set(id, version);
      places.set(id, 0);
      founded.set(id, [{ rev, pending }]);
      stand(id, version);
      const message: Message = { id, role: entry.role, at: entry.at, versions: [version], selected: 0 };
      messages.set(id, message);
      home.set(version, message);
      continue;
    }
    if (entry.type === 'vars') {
      const version = edits.get(entry.version);
      if (entry.byHand) {
        if (version) version.byHand = [...(version.byHand ?? []), ...entry.set];
        continue;
      }
      const holder = entry.stays ? version && home.get(version) : version;
      if (holder) holder.after = [...(holder.after ?? []), ...entry.set];
      continue;
    }
    if (entry.type === 'call') {
      const version = edits.get(entry.version);
      if (version) version.calls = [...(version.calls ?? []), { receipt: entry.receipt, at: entry.at }];
      continue;
    }
    if (entry.type === 'agentMemory') {
      const version = edits.get(entry.version);
      if (version) version.memories = { ...version.memories, [entry.agent]: entry.memory };
      continue;
    }
    if (entry.type === 'cost') {
      costs.set(entry.replyId, entry.cost);
      continue;
    }
    if (entry.type === 'translation') {
      const version = own.get(entry.version);
      if (version) version.translation = { text: entry.text, receipt: entry.receipt, at: entry.at };
      continue;
    }
    const message = messages.get(entry.message);
    if (!message) continue;
    if (entry.type === 'version') {
      const slot = entry.replaces === null ? -1 : locate(message, entry.replaces);
      const edited = entry.edit ? message.versions[slot] : undefined;
      const version = versionOf(id, entry, entry.edit, entry.staged === true || edited?.staged === true);
      if (edited) {
        if (edited.before) version.before = [...edited.before, ...(entry.before ?? [])];
        if (edited.after) version.after = edited.after;
        if (edited.byHand) version.byHand = edited.byHand;
        if (edited.calls) version.calls = edited.calls;
        if (edited.reasoning) version.reasoning = edited.reasoning;
        if (edited.memories) version.memories = edited.memories;
        if (edited.raw !== undefined && entry.raw === undefined) {
          version.raw = edited.raw;
          if (entry.text !== edited.raw) version.retouched = true;
        }
        version.earlier = ids.get(edited)!;
      }
      own.set(id, version);
      home.set(version, message);
      stand(id, version, edited && ids.get(edited));
      if (slot === -1) {
        message.versions.push(version);
        founded.get(message.id)!.push({ rev, pending });
      } else message.versions[slot] = version;
      message.selected = slot === -1 ? message.versions.length - 1 : slot;
      places.set(id, message.selected);
    } else if (entry.type === 'select') {
      const slot = locate(message, entry.version);
      if (slot !== -1) message.selected = slot;
    } else if (entry.type === 'delete') {
      deleted.add(message.id);
    } else if (entry.type === 'restore') {
      deleted.delete(message.id);
    }
  }

  const settled = (receipt: Receipt): Receipt => {
    const earlier = receipt.continues && settled(receipt.continues);
    const own = receipt.cost === 'pending' && receipt.replyId && costs.has(receipt.replyId) ? { ...receipt, cost: costs.get(receipt.replyId)! } : receipt;
    return earlier === receipt.continues ? own : { ...own, continues: earlier };
  };
  return { deleted, places, founded, messages: [...messages.values()]
    .map((message) => ({
      ...message,
      versions: message.versions.map((version) => {
        const receipt = version.receipt && settled(version.receipt);
        const translated = version.translation?.receipt && settled(version.translation.receipt);
        const made = version.calls?.map((call) => ({ ...call, receipt: settled(call.receipt) }));
        if (receipt === version.receipt && translated === version.translation?.receipt && !made?.some((call, index) => call.receipt !== version.calls![index]!.receipt)) return version;
        return { ...version, receipt, ...(version.translation && { translation: { ...version.translation, receipt: translated ?? null } }), ...(made && { calls: made }) };
      }),
    })) };
}

type EntryIndex = { group: string | null; reference?: string; cost?: string; rev: number; pending?: number; at: number };
// moved: the order of the follow entry that set follows; null when the message's own entry did.
type FoldedMessage = { entries: Set<string>; costs: Set<string>; message: Message | null; deleted: boolean; places: Map<string, number>; founded: Order[]; follows: string | null | undefined; moved: Order | null };
// slot: the one of from's versions it continues; null for a message saved before follows (Entry).
type Edge = { group: FoldedMessage; slot: number | null };
export const entryOrder = (a: { rev: number; pending?: number }, b: { rev: number; pending?: number }) => (a.pending ?? 0) - (b.pending ?? 0) || a.rev - b.rev;

// Only indexes and the projection live here. Values, including pending writes, are always read from the store.
export class ChatFold {
  private readonly dirty = new Set<string>();
  private readonly entries = new Map<string, EntryIndex>();
  private readonly references = new Map<string, Set<string>>();
  private readonly costs = new Map<string, Set<string>>();
  private readonly costUsers = new Map<string, Set<string>>();
  private readonly groups = new Map<string, FoldedMessage>();
  private result: { messages: Message[]; at: number | null } = { messages: [], at: null };

  constructor(private readonly read: (id: string) => Stored<'entry'> | null) {}

  changed(id: string) { this.dirty.add(id); }

  snapshot(): { messages: Message[]; at: number | null } {
    if (!this.dirty.size) return this.result;
    const touched = new Set<string>();
    const costs = new Set<string>();
    const ids = new Set(this.dirty);
    this.dirty.clear();
    for (const id of ids) for (const reference of this.references.get(id) ?? []) ids.add(reference);
    for (const id of ids) {
      const old = this.entries.get(id);
      if (old && old.group !== null) {
        this.groups.get(old.group)!.entries.delete(id);
        touched.add(old.group);
      }
      if (old?.reference) this.remove(this.references, old.reference, id);
      if (old?.cost) { this.remove(this.costs, old.cost, id); costs.add(old.cost); }
      const stored = this.read(id);
      if (!stored) { this.entries.delete(id); continue; }
      const { value, rev, pending } = stored;
      const reference = 'version' in value && !('message' in value) ? value.version : undefined;
      const target = reference ? this.read(reference)?.value : undefined;
      const group = value.type === 'message' ? id : 'message' in value ? value.message
        : target?.type === 'message' ? reference! : target?.type === 'version' ? target.message : null;
      const cost = value.type === 'cost' ? value.replyId : undefined;
      this.entries.set(id, { group, reference, cost, rev, pending, at: value.at });
      if (reference) this.add(this.references, reference, id);
      if (cost) { this.add(this.costs, cost, id); costs.add(cost); }
      if (group !== null) {
        let held = this.groups.get(group);
        if (!held) this.groups.set(group, (held = { entries: new Set(), costs: new Set(), message: null, deleted: false, places: new Map(), founded: [], follows: undefined, moved: null }));
        held.entries.add(id);
        touched.add(group);
      }
    }
    for (const cost of costs) for (const group of this.costUsers.get(cost) ?? []) touched.add(group);
    for (const id of touched) {
      const group = this.groups.get(id)!;
      for (const cost of group.costs) this.remove(this.costUsers, cost, id);
      group.costs.clear();
      const entries = [...group.entries].map((entry) => this.read(entry)!);
      const receipt = (value: Receipt | null) => {
        for (const call of value ? calls(value) : []) if (call.replyId) group.costs.add(call.replyId);
      };
      for (const { value } of entries) {
        if ('receipt' in value) receipt(value.receipt);
        if ('translation' in value && value.translation) receipt(value.translation.receipt);
      }
      for (const cost of group.costs) {
        this.add(this.costUsers, cost, id);
        for (const entry of this.costs.get(cost) ?? []) entries.push(this.read(entry)!);
      }
      const folded = replay(entries);
      group.message = folded.messages[0] ?? null;
      group.deleted = folded.deleted.has(id);
      group.places = folded.places;
      group.founded = folded.founded.get(id) ?? [];
      const head = entries.find((entry) => entry.id === id)?.value;
      const moved = entries.filter(({ value }) => value.type === 'follow').sort(entryOrder).at(-1);
      group.follows = moved ? (moved.value as Extract<Entry, { type: 'follow' }>).follows : head?.type === 'message' ? head.follows : undefined;
      group.moved = moved ? { rev: moved.rev, pending: moved.pending } : null;
      if (!group.entries.size) this.groups.delete(id);
    }
    const messages: Message[] = [];
    for (const { group } of this.walk(false)) {
      const message = group.message!;
      if (!group.deleted) messages.push(message);
      else if (messages.length && message.after) {
        const last = messages.at(-1)!;
        messages[messages.length - 1] = { ...last, after: [...(last.after ?? []), ...message.after] };
      }
    }
    let latest: EntryIndex | null = null;
    for (const entry of this.entries.values()) if (!latest || entry.rev >= latest.rev) latest = entry;
    this.result = { messages, at: latest?.at ?? null };
    return this.result;
  }

  // Every message a version switch can show, not only those shown, each with the version it continues: the nearest
  // one shown above it, past deleted messages. A deleted message is passed through its selected version only, as the
  // story shows it.
  tree(): { message: Message; follows: string | null }[] {
    this.snapshot();
    const out: { message: Message; follows: string | null }[] = [];
    const held = new Map<string, number>();
    for (const { group, follows } of this.walk(true)) {
      const message = group.message!;
      if (!group.deleted) {
        for (const { id } of message.versions) held.set(id, out.length);
        out.push({ message, follows });
        continue;
      }
      const at = follows === null ? undefined : held.get(follows);
      if (at === undefined || !message.after) continue;
      const kept = out[at]!;
      out[at] = { ...kept, message: { ...kept.message, after: [...(kept.message.after ?? []), ...message.after] } };
    }
    return out;
  }

  // The story in the order it reads: from each first message, down the version each message shows (every: down all
  // of them), a message's continuations in rev order one after another, so two saved after the same version both show.
  // Iterative, since a chat may run to thousands of messages.
  private walk(every: boolean): { group: FoldedMessage; follows: string | null }[] {
    const ordered = [...this.groups.values()].filter((group) => group.message !== null)
      .sort((a, b) => entryOrder(this.entries.get(a.message!.id)!, this.entries.get(b.message!.id)!));
    // A message continues only one saved before the entry that named it, so a follows naming a later or unknown
    // version starts a line of its own. Follow entries can still close a loop (two devices moving at once): the line
    // is cut at the latest move in it, which then starts its own.
    const owner = new Map<string, FoldedMessage>();
    for (const group of ordered) for (const id of group.places.keys()) owner.set(id, group);
    const parents = new Map<FoldedMessage, Edge & { parent: FoldedMessage }>();
    let previous: FoldedMessage | undefined;
    for (const group of ordered) {
      const named = group.follows ? owner.get(group.follows) : undefined;
      const slot = named && named.places.get(group.follows!)!;
      const saved = named && entryOrder(named.founded[slot!]!, group.moved ?? this.entries.get(group.message!.id)!) < 0;
      const parent = group.follows === undefined ? previous : saved ? named : undefined;
      if (parent) parents.set(group, { group, slot: group.follows ? slot! : null, parent });
      previous = group;
    }
    const seen = new Map<FoldedMessage, 'path' | 'done'>();
    for (const start of ordered) {
      const path: FoldedMessage[] = [];
      for (let at: FoldedMessage | undefined = start; at && seen.get(at) !== 'done'; at = parents.get(at)?.parent) {
        if (seen.get(at) === 'path') {
          const loop = path.slice(path.indexOf(at)).filter((member) => member.moved);
          parents.delete(loop.sort((a, b) => entryOrder(a.moved!, b.moved!)).at(-1) ?? at);
          break;
        }
        seen.set(at, 'path');
        path.push(at);
      }
      for (const member of path) seen.set(member, 'done');
    }
    // Among one version's continuations, a message put ahead of another (a follow entry) stands where that one
    // stood, not where its later save would put it; so does one put ahead of that.
    const order = new Map<FoldedMessage, EntryIndex>(ordered.map((group) => [group, this.entries.get(group.message!.id)!]));
    for (const group of ordered) {
      if (!group.moved) continue;
      const held = order.get(group)!;
      for (let at = parents.get(group)?.parent; at && entryOrder(held, order.get(at)!) < 0; at = parents.get(at)?.parent) order.set(at, held);
    }
    const edges = new Map<FoldedMessage, Edge[]>();
    const roots: FoldedMessage[] = [];
    for (const group of ordered) {
      const edge = parents.get(group);
      if (!edge) roots.push(group);
      else {
        const held = edges.get(edge.parent);
        if (held) held.push(edge);
        else edges.set(edge.parent, [edge]);
      }
    }
    for (const kids of edges.values()) kids.sort((a, b) => entryOrder(order.get(a.group)!, order.get(b.group)!));
    const out: { group: FoldedMessage; follows: string | null }[] = [];
    const stack: { group: FoldedMessage; follows: string | null }[] = roots.map((group) => ({ group, follows: null })).reverse();
    while (stack.length) {
      const next = stack.pop()!;
      out.push(next);
      const { group } = next;
      const { versions, selected } = group.message!;
      const kids = (edges.get(group) ?? []).flatMap(({ group: kid, slot }) => {
        const order = this.entries.get(kid.message!.id)!;
        const before = (index: number) => entryOrder(group.founded[index]!, order) < 0;
        const continued = slot ?? (before(selected) ? selected : group.founded.findLastIndex((_, index) => before(index)));
        if (continued !== selected && (!every || group.deleted)) return [];
        return [{ group: kid, follows: group.deleted ? next.follows : versions[continued]!.id }];
      });
      stack.push(...kids.reverse());
    }
    return out;
  }

  private add(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key);
    if (ids) ids.add(id);
    else index.set(key, new Set([id]));
  }

  private remove(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key)!;
    ids.delete(id);
    if (!ids.size) index.delete(key);
  }
}

function folded(entries: Stored<'entry'>[]): ChatFold {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const projection = new ChatFold((id) => byId.get(id) ?? null);
  for (const id of byId.keys()) projection.changed(id);
  return projection;
}

export const fold = (entries: Stored<'entry'>[]): Message[] => folded(entries).snapshot().messages;

export const foldTree = (entries: Stored<'entry'>[]) => folded(entries).tree();

export const shown = (message: Message): Version => message.versions[message.selected]!;

// By every id a version stood under, the one it stands under now: what follows a version into its edits (삽화) is
// read through it, never by the id it was saved with.
export const standing = (messages: readonly Message[]): Map<string, string> =>
  new Map(messages.flatMap(({ versions }) => versions.flatMap(({ id, earlier = [] }) => [...earlier, id].map((each): [string, string] => [each, id]))));

// The text is the user's now: an edit, never what post agents wrote, which is saved as an edit (runtime/chat-log
// appendPolished) and keeps raw. A user's edit of a polished reply keeps raw too, and reads as not theirs here.
export const handEdited = (version: Version) => version.edited && version.raw === undefined;

// An edit that changed the text and left the translation keeps the translation's time (runtime/chat-log editMessage).
export const translationOutdated = (version: Version) => version.edited && version.translation !== undefined && version.translation.at < version.at;

export const calls = (receipt: Receipt): Receipt[] => [...(receipt.continues ? calls(receipt.continues) : []), receipt];

const lines = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export const firstLine = (text: string) => lines(text)[0] ?? '';

const prose = (line: string) => !line.startsWith('#') && /\p{L}{2}/u.test(line.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ''));

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
// The stored text still holds its CBS, which the displayed one shows filled ({{char}} enters → Luna enters).
const CBS_PART = /\{\{[\s\S]*?\}\}|<(?:user|char|bot)>/gi;
// Shorter, a piece between two tags ('. ') would be found in any line.
const PIECE_LEAST = 6;

// Many bots open every reply with the same status line, which tells one chat from the next no better than a blank.
// story: the message's own text. A line the bot's scripts brought in is passed over too: a settings panel kept off
// the screen until opened reads as prose.
export function previewLine(text: string, story: string): string {
  const all = lines(text);
  const pieces = story.split(CBS_PART).flatMap(lines).map(squash);
  const own = (line: string) => pieces.some((piece) => piece.includes(line) || (piece.length >= PIECE_LEAST && line.includes(piece)));
  return all.find((line) => prose(line) && own(squash(line))) ?? all.find(prose) ?? all[0] ?? '';
}

// texts: each message's text as it is displayed (engine/render, which the model cannot call).
export function chatTitle(chat: Chat, messages: Message[], texts: string[]): string {
  if (chat.title) return chat.title;
  if (chat.origin) return `${chat.origin.name} · 분기`;
  const first = messages.findIndex((message) => message.role === 'user');
  return (first !== -1 && firstLine(texts[first]!)) || '새 채팅';
}

// count and preview are null while the chat has no saved summary.
export type ChatSummary = { id: string; chat: Chat; count: number | null; title: string; preview: string | null; at: number | null; order: number };
export type ChatItem = ChatSummary & { count: number; preview: string; messages: Message[] };
export type SummaryRead = ({ kind: Kind; id: string } | { kind: Kind; list: true } | { kind: Kind; parent: string }) & { rev: number };
export type Summary = {
  version: number;
  head: number;
  chatRev: number;
  dependencies: SummaryRead[];
  rendered: { now: number; timeZone: string };
  character: string | null;
  title: string;
  preview: string;
  count: number;
  at: number | null;
  order: number;
  recent: RecentModel[];
  // The chat's bot judged stuck (runtime ChatProjections.verdict), on the reads that stand for it; absent when never.
  stuck?: { dependencies: SummaryRead[] };
};
export type RecentModel = { at: number; ref: ModelRef };

export const usageCall = ({ id, connection, model, modelName, source, usage, cost, calibration }: Receipt, at: number): UsageCall => ({ at, call: { id, connection, model, modelName, source, usage, cost, ...(calibration && { calibration }) } });

// Every call a chat's log keeps, whatever the chat still shows: a deleted message's, a translation made again. An edit
// keeps the receipt it changes, so a call counts once, at its first entry. booked: what each cost entry booked for the
// calls it names.
export function loggedCalls(entries: Iterable<Entry>): { calls: UsageCall[]; booked: { call: string; cost: Cost | null }[] } {
  const kept = new Map<string, UsageCall>();
  const replies = new Map<string, string[]>();
  const booked: { replyId: string; cost: Cost | null }[] = [];
  const keep = (receipt: Receipt | null | undefined, at: number) => {
    for (const call of receipt ? calls(receipt) : []) {
      if (kept.has(call.id)) continue;
      kept.set(call.id, usageCall(call, at));
      if (call.replyId) replies.set(call.replyId, [...(replies.get(call.replyId) ?? []), call.id]);
    }
  };
  for (const entry of entries) {
    if (entry.type === 'message' || entry.type === 'version') {
      keep(entry.receipt, entry.at);
      if (entry.translation) keep(entry.translation.receipt, entry.translation.at);
    } else if (entry.type === 'translation' || entry.type === 'call') keep(entry.receipt, entry.at);
    else if (entry.type === 'cost') booked.push(entry);
  }
  return { calls: [...kept.values()], booked: booked.flatMap(({ replyId, cost }) => (replies.get(replyId) ?? []).map((call) => ({ call, cost }))) };
}

export const callRef = ({ connection, model, entry }: Pick<Receipt, 'connection' | 'model' | 'entry'>): ModelRef => ({ connection, model: entry ?? model });

export function recentIn(messages: Message[]): RecentModel[] {
  const used = messages.flatMap((message) => message.versions)
    .flatMap((version) => (version.receipt ? [{ at: version.at, ref: callRef(version.receipt) }] : []))
    .sort((a, b) => b.at - a.at);
  const latest: RecentModel[] = [];
  for (const model of used) {
    if (latest.some(({ ref }) => ref.connection === model.ref.connection && ref.model === model.ref.model)) continue;
    latest.push(model);
    if (latest.length === 3) break;
  }
  return latest;
}

export function recentModels(chats: RecentModel[][], limit: number): ModelRef[] {
  const used = chats.flat().sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const refs: ModelRef[] = [];
  for (const { ref } of used) {
    const key = `${ref.connection}/${ref.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length === limit) break;
  }
  return refs;
}
