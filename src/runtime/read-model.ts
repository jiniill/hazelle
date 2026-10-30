import { ChangeSignal } from '../change-signal';
import type { Display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { chatTitle, shown, standing, type Chat, type ChatSummary, type Message } from '../model/chat';
import { placeOf, withMarks, withoutMarks } from '../model/illustration';
import type { Illustrating, Illustrator } from './illustrate';
import type { Kind, Stored, Values } from '../model/kinds';
import { indexFolders, nest, type FolderIndex, type FolderTree } from '../model/folders';
import { isLive, live, shelve, type CharacterShelf, type Shelf } from '../model/library';
import type { Memory } from '../model/memory';
import { EMPTY_SETTINGS, SETTINGS_ID, type Settings } from '../model/settings';
import type { ApiFailure } from './api';
import type { ScopeState } from './chat-scope';
import { EvaluationStopped, EvaluationStuck } from './evaluation';
import type { ScriptDisplay } from './script-display';
import { type ObjectStore } from './store';
import { readsChanged } from './store-changes';
import type { StoreChange, StoreRead } from './object-index';
import { withTurn, type Shown, type Talk, type Turn } from './talk';
import { evaluateChat } from './chat-context';
import { storedMemory } from './memory-read';
import { SCOPED } from './object-cache';
import { summaryId, type ChatModel } from './summary';
import type { ToolMenu, Tools } from './tools/facade';

// Held until set: a snapshot that is a fresh value on every read would make React re-render forever.
class Snapshot<T> {
  private readonly changes = new ChangeSignal();
  constructor(private value: T) {}
  readonly snapshot = () => this.value;
  readonly subscribe = this.changes.subscribe;
  set(value: T) {
    if (value === this.value) return;
    this.value = value;
    this.changes.notify();
  }
}

// byCharacter includes deleted characters, but none being purged.
export type Library = {
  characters: CharacterShelf<ChatSummary>[];
  none: Shelf<ChatSummary>;
  deleted: CharacterShelf<ChatSummary>[];
  deletedChats: ChatSummary[];
  byCharacter: ReadonlyMap<string, CharacterShelf<ChatSummary>>;
} & FolderIndex<CharacterShelf<ChatSummary>>;

const liveShelf = (shelf: CharacterShelf<ChatSummary> | undefined) => (shelf && isLive(shelf.character) ? shelf : null);

export type ChatScopeRead = { state: ScopeState; error: ApiFailure | null };

export type OpenDisplay = Pick<ScriptDisplay, 'display' | 'subscribe'>;
export const plainDisplay = (store: ObjectStore): OpenDisplay => ({ display: (id, chat, messages, screen, signal) => evaluateChat({ store }, id, chat, messages, screen, signal), subscribe: () => () => {} });

// Sort listed kinds by name, not store write order: edits must not move items in their lists.
const NAMED: { [K in Kind]?: (value: Values[K]) => string } = {
  connection: (value) => value.label,
  module: (value) => value.name,
  persona: (value) => value.name,
  profile: (value) => value.name,
  prompt: (value) => value.name,
};
const memo = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = make()));
  return value;
};
const sameItems =<T>(left: T[], right: T[]) => left.length === right.length && left.every((item, index) => item === right[index]);
const sameSummary = (a: ChatSummary, b: ChatSummary) => a.chat === b.chat && a.count === b.count && a.title === b.title && a.preview === b.preview && a.at === b.at && a.order === b.order;
// An equal one is kept, so the lists holding it stay the same.
function place(map: Map<string, ChatSummary>, id: string, next: ChatSummary | null): boolean {
  if (!next) return map.delete(id);
  const previous = map.get(id);
  if (previous && sameSummary(previous, next)) return false;
  map.set(id, next);
  return true;
}

export class ReadModels {
  private readonly summaries = new Map<string, ChatSummary>();
  private readonly binned = new Map<string, ChatSummary>();
  private readonly byChat = new Map<string, Snapshot<ChatModel | null>>();
  private readonly bySummary = new Map<string, Snapshot<ChatSummary | null>>();
  private readonly byKind = new Map<Kind, Snapshot<Stored<Kind>[]>>();
  private readonly byObject = new Map<string, { kind: Kind; state: Snapshot<Stored<Kind> | null> }>();
  private readonly byCharacter = new Map<string, Snapshot<CharacterShelf<ChatSummary> | null>>();
  private readonly byChildren = new Map<string, { kind: Kind; parent: string; state: Snapshot<Stored<Kind>[]> }>();
  private readonly byMemory = new Map<string, Snapshot<Memory | null>>();
  private readonly byTools = new Map<string, { chat: string; host: Pick<Tools, 'menus'>; reads: StoreRead[]; state: Snapshot<ToolMenu[]> }>();
  private readonly byScope = new Map<string, Snapshot<ChatScopeRead>>();
  private folders: FolderTree[];
  readonly chats = new Snapshot<ChatSummary[]>([]);
  readonly library: Snapshot<Library>;
  // Until something is saved, nothing is assigned: an empty layer, not a guessed default.
  readonly settings: Snapshot<Settings>;
  readonly unreadable: Snapshot<number>;
  private readonly leave: () => void;

  constructor(readonly store: ObjectStore) {
    this.folders = nest(store.list('folder'), 'character');
    this.settings = new Snapshot(store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable = new Snapshot(store.unreadable());
    this.updateLists();
    this.library = new Snapshot(this.buildLibrary());
    this.leave = store.subscribe((changes) => this.changed(changes));
  }

  chat(id: string): Snapshot<ChatModel | null> {
    return memo(this.byChat, id, () => new Snapshot(this.store.projections.get(id)?.model ?? null));
  }

  summary(id: string): Snapshot<ChatSummary | null> {
    return memo(this.bySummary, id, () => new Snapshot(this.summaries.get(id) ?? null));
  }

  private listed<K extends Kind>(kind: K): Stored<K>[] {
    const name = NAMED[kind] as ((value: Values[K]) => string) | undefined;
    const list = this.store.list(kind);
    return name ? list.sort((a, b) => name(a.value).localeCompare(name(b.value), 'ko') || a.id.localeCompare(b.id)) : list;
  }

  kind<K extends Kind>(kind: K): Snapshot<Stored<K>[]> {
    return memo(this.byKind, kind, () => new Snapshot<Stored<Kind>[]>(this.listed(kind))) as Snapshot<Stored<K>[]>;
  }

  object<K extends Kind>(kind: K, id: string): Snapshot<Stored<K> | null> {
    return memo(this.byObject, `${kind}:${id}`, () => ({ kind, state: new Snapshot<Stored<Kind> | null>(this.store.get(kind, id)) })).state as Snapshot<Stored<K> | null>;
  }

  character(id: string): Snapshot<CharacterShelf<ChatSummary> | null> {
    return memo(this.byCharacter, id, () => new Snapshot(liveShelf(this.library.snapshot().byCharacter.get(id))));
  }

  children<K extends Kind>(kind: K, parent: string): Snapshot<Stored<K>[]> {
    return memo(this.byChildren, `${kind}:${parent}`, () => ({ kind, parent, state: new Snapshot<Stored<Kind>[]>(this.childrenOf(kind, parent)) })).state as Snapshot<Stored<K>[]>;
  }

  memory(chat: string): Snapshot<Memory | null> {
    return memo(this.byMemory, chat, () => new Snapshot(this.memoryOf(chat)));
  }

  // host: the session's one tool host, whose menus answer from the store alone.
  tools(chat: string, host: Pick<Tools, 'menus'>): Snapshot<ToolMenu[]> {
    return memo(this.byTools, chat, () => {
      const held = { chat, host, reads: [] as StoreRead[], state: new Snapshot<ToolMenu[]>([]) };
      held.state.set(this.menusOf(held));
      return held;
    }).state;
  }

  scope(chat: string): Snapshot<ChatScopeRead> {
    return memo(this.byScope, chat, () => new Snapshot(this.scopeOf(chat)));
  }

  // A chat's own kinds (store SCOPED) are there only while it is loaded, and a scope change reads them again.
  private childrenOf<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    return SCOPED.has(kind) && this.store.scopeState(parent) !== 'loaded' ? [] : this.store.children(kind, parent);
  }

  private memoryOf(chat: string): Memory | null {
    return this.store.scopeState(chat) === 'loaded' ? storedMemory(this.store, chat)?.value ?? null : null;
  }

  private menusOf(held: { chat: string; host: Pick<Tools, 'menus'>; reads: StoreRead[] }): ToolMenu[] {
    const { value, reads } = this.store.capture(() => held.host.menus(held.chat));
    held.reads = reads;
    return value;
  }

  private scopeOf(chat: string): ChatScopeRead {
    return { state: this.store.scopeState(chat), error: this.store.scopeError(chat) };
  }

  screen(id: string, talk: Pick<Talk, 'snapshot' | 'subscribe'>, drawings: Drawings, opening: Opening, open: OpenDisplay): ChatScreenRead {
    return new ChatScreenRead(this, talk, drawings, id, opening, open);
  }

  async displayed(id: string): Promise<ScreenChat | null> {
    await this.store.projections.evaluate(id);
    const model = this.chat(id).snapshot();
    return model && { chat: model.chat, messages: withTurn(model.messages, null, id), display: model.display, stuck: this.store.projections.verdict(id) !== null };
  }

  close() {
    this.leave();
    for (const snapshot of this.byChat.values()) snapshot.set(null);
    this.byChat.clear();
  }

  private changed(changes: readonly StoreChange[]) {
    for (const [id, snapshot] of this.byChat) snapshot.set(this.store.projections.get(id)?.model ?? null);
    const listsChanged = this.updateLists(changes);
    const kinds = new Set(changes.map((change) => change.kind));
    for (const [kind, snapshot] of this.byKind) {
      if (!kinds.has(kind)) continue;
      const next = this.listed(kind);
      if (!sameItems(snapshot.snapshot(), next)) snapshot.set(next);
    }
    if (kinds.has('settings')) this.settings.set(this.store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable.set(this.store.unreadable());
    if (kinds.has('folder')) this.folders = nest(this.store.list('folder'), 'character');
    if (listsChanged || ['character', 'avatar', 'folder'].some((kind) => kinds.has(kind))) {
      const library = this.buildLibrary();
      this.library.set(library);
      for (const [id, snapshot] of this.byCharacter) snapshot.set(liveShelf(library.byCharacter.get(id)));
    }
    for (const change of changes) {
      const object = this.byObject.get(`${change.kind}:${change.id}`);
      if (object) object.state.set(this.store.get(object.kind, change.id));
    }
    const touched = (kind: string, parent: string) => changes.some((change) => (change.kind === kind || change.kind === 'scope') && change.parent === parent);
    for (const { kind, parent, state } of this.byChildren.values()) {
      if (!touched(kind, parent)) continue;
      const next = this.childrenOf(kind, parent);
      if (!sameItems(state.snapshot(), next)) state.set(next);
    }
    for (const [chat, state] of this.byMemory) if (touched('memory', chat)) state.set(this.memoryOf(chat));
    for (const held of this.byTools.values()) if (readsChanged(held.reads, changes)) held.state.set(this.menusOf(held));
    for (const [chat, state] of this.byScope) if (changes.some((change) => change.kind === 'scope' && change.id === chat)) state.set(this.scopeOf(chat));
  }

  // Renaming a populated chat or changing its model does not move it.
  private updateLists(changes?: readonly StoreChange[]): boolean {
    const ids = changes
      ? new Set(changes.flatMap((change) => change.kind === 'chat' ? [change.id] : change.kind === 'summary' && change.parent ? [change.parent] : []))
      : new Set(this.store.list('chat').map(({ id }) => id));
    let changed = false;
    let binChanged = false;
    for (const id of ids) {
      const stored = this.store.get('chat', id);
      const next = stored && this.summarize(stored);
      const alive = live(stored) !== null;
      if (place(this.summaries, id, alive ? next : null)) {
        this.bySummary.get(id)?.set(this.summaries.get(id) ?? null);
        changed = true;
      }
      if (place(this.binned, id, alive ? null : next)) binChanged = true;
    }
    if (changed) this.chats.set([...this.summaries.values()].sort((a, b) => b.order - a.order));
    return changed || binChanged;
  }

  private summarize({ id, value: chat, rev }: Stored<'chat'>): ChatSummary {
    const saved = this.store.get('summary', summaryId(id))?.value;
    return {
      id, chat, count: saved?.count ?? null,
      title: chat.title ?? (chat.origin ? `${chat.origin.name} · 분기` : saved?.title ?? chatTitle(chat, [], [])),
      preview: saved?.preview ?? null, at: saved?.at ?? null, order: saved?.order ?? rev,
    };
  }

  private buildLibrary(): Library {
    const shelves = shelve(this.store.list('character'), this.store.list('avatar'), this.chats.snapshot(), [...this.binned.values()]);
    const previous = this.library?.snapshot();
    const reuse = <T extends Shelf<ChatSummary>>(shelf: T): T => {
      const held = shelf.id === null ? previous?.none : previous?.byCharacter.get(shelf.id);
      return held && held.character === shelf.character && held.face === shelf.face && sameItems(held.chats, shelf.chats) ? held as T : shelf;
    };
    const next = { characters: shelves.characters.map(reuse), deleted: shelves.deleted.map(reuse), deletedChats: shelves.deletedChats, none: reuse(shelves.none), folders: this.folders };
    const sameCharacters = previous !== undefined && sameItems(previous.characters, next.characters);
    const sameDeleted = previous !== undefined && sameItems(previous.deleted, next.deleted);
    if (previous && sameCharacters && sameDeleted && sameItems(previous.deletedChats, next.deletedChats) && previous.none === next.none && previous.folders === next.folders) return previous;
    const byCharacter = previous && sameCharacters && sameDeleted ? previous.byCharacter : new Map([...next.characters, ...next.deleted].map((shelf) => [shelf.id, shelf]));
    const filed = previous && sameCharacters && previous.folders === next.folders ? { byFolder: previous.byFolder, loose: previous.loose } : indexFolders(next.characters, next.folders, (shelf) => shelf.character.folder);
    return { ...next, byCharacter, ...filed };
  }
}

export type Opening = { chat: Chat; messages: Message[] };
// stuck: the display left the bot's regex out, its chat judged stuck (ChatProjections.verdict).
export type ScreenChat = { chat: Chat; messages: Shown[]; display: Display; stuck: boolean; pending?: boolean; error?: unknown };
// placed: by message index, the shown text of a message whose 삽화 have a place, with their marks as the display left
// them (model/illustration withMarks); display.texts hold none.
export type ChatScreen = ScreenChat & { placed: ReadonlyMap<number, string> };
type Drawings = Pick<Illustrator, 'snapshot' | 'subscribe'>;

// By version, the paragraphs its pictures and its picture being drawn stand after.
function placesOf(store: ObjectStore, chat: string, messages: readonly Message[], drawings: Illustrating): Map<string, Set<number>> {
  const places = new Map<string, Set<number>>();
  const add = (version: string, paragraph: number) => places.set(version, (places.get(version) ?? new Set()).add(paragraph));
  const versions = standing(messages);
  const texts = new Map(messages.map((message) => [shown(message).id, shown(message).text]));
  for (const { value } of store.children('illustration', chat)) {
    const version = versions.get(value.version);
    const text = version && texts.get(version);
    if (text !== undefined) add(version!, placeOf(value, text));
  }
  for (const drawing of drawings.values()) if (drawing.chat === chat) for (const { scene } of drawing.sketches) add(drawing.version, scene.paragraph);
  return places;
}

const drawingKey = (chat: string, drawings: Illustrating) =>
  [...drawings.values()].flatMap((drawing) => (drawing.chat === chat ? drawing.sketches.map(({ scene }) => `${drawing.version}:${scene.paragraph}`) : [])).sort().join(' ');

function marked(messages: Shown[], places: Map<string, Set<number>>): Shown[] {
  if (!places.size) return messages;
  return messages.map((message) => {
    const paragraphs = places.get(shown(message).id);
    return paragraphs ? { ...message, versions: message.versions.map((version, index) => (index === message.selected ? { ...version, text: withMarks(version.text, paragraphs) } : version)) } : message;
  });
}

function placing(display: Display): { display: Display; placed: Map<number, string> } {
  const placed = new Map<number, string>();
  const texts = display.texts.map((text, index) => {
    const clean = withoutMarks(text);
    if (clean !== text) placed.set(index, text);
    return clean;
  });
  return { display: placed.size ? { ...display, texts } : display, placed };
}

export class ChatScreenRead {
  private readonly state: Snapshot<ChatScreen>;
  private reads: StoreRead[] = [];
  private evaluation: AbortController | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private screen: ChatScope['screen'] = null;
  // Whether the latest refresh ran under a verdict.
  private judged = false;
  private turn: Turn | null;
  private base: Opening | null;
  private drawing: string;
  private readonly listeners = new Set<() => void>();
  private leave: (() => void) | null = null;

  constructor(private readonly models: ReadModels, private readonly talk: Pick<Talk, 'snapshot' | 'subscribe'>, private readonly drawings: Drawings, readonly id: string, private opening: Opening, private readonly open: OpenDisplay) {
    this.base = this.based();
    this.turn = this.currentTurn();
    this.drawing = drawingKey(id, drawings.snapshot());
    this.state = new Snapshot<ChatScreen>({ chat: opening.chat, messages: [], display: { texts: [], thoughts: [], css: '', drawn: [], boxes: [], pass: false, unfound: [], stopped: null }, stuck: false, pending: true, placed: new Map() });
  }

  readonly snapshot = () => this.state.snapshot();
  readonly subscribe = (listener: () => void) => {
    if (!this.leave) {
      const lease = this.models.store.retainChat(this.id);
      const store = this.models.store.subscribe((changes) => {
        const base = this.based();
        if (base === this.base && !readsChanged(this.reads, changes) && this.verdict() === this.judged) return;
        this.base = base;
        this.refresh();
      });
      const talk = this.talk.subscribe(() => {
        const turn = this.currentTurn();
        if (turn === this.turn) return;
        this.turn = turn;
        this.refresh();
      });
      // Only a scene landing or going moves a picture's place.
      const drawn = this.drawings.subscribe(() => {
        const drawing = drawingKey(this.id, this.drawings.snapshot());
        if (drawing === this.drawing) return;
        this.drawing = drawing;
        this.refresh();
      });
      const passed = this.open.subscribe(this.id, (display) => {
        if (!display) return this.refresh();
        this.state.set({ ...this.state.snapshot(), ...placing(display) });
      });
      this.leave = () => { this.again = false; this.evaluation?.abort(); store(); talk(); drawn(); passed(); lease.release(); };
      const base = this.based();
      const turn = this.currentTurn();
      // A pass the display was missing while nobody listened was not run: it is asked for again now. A pass running
      // now lands with a listener, so it is not, unless it was the one a leave just stopped.
      const landing = this.running !== null && !this.evaluation?.signal.aborted;
      if (base !== this.base || turn !== this.turn || (!landing && (this.state.snapshot().display.pass || this.state.snapshot().pending))) {
        this.base = base;
        this.turn = turn;
        this.refresh();
      }
    }
    const unsubscribe = this.state.subscribe(listener);
    this.listeners.add(listener);
    return () => {
      unsubscribe();
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.leave?.(); this.leave = null; }
    };
  };

  setInputs(opening: Opening, screen: ChatScope['screen']) {
    const changed = this.screen?.width !== screen?.width || this.screen?.height !== screen?.height || (!this.base && (opening.chat !== this.opening.chat || opening.messages !== this.opening.messages));
    this.opening = opening;
    this.screen = screen;
    if (changed) this.refresh();
  }

  private currentTurn() {
    return this.talk.snapshot(this.id);
  }

  // Read the store's immediate fold, not the delayed display projection, or ending a turn briefly hides its saved reply.
  private based(): Opening | null {
    const { store } = this.models;
    const stored = store.scopeState(this.id) === 'loaded' ? live(store.get('chat', this.id)) : null;
    if (!stored) return null;
    const { messages } = store.foldedChat(this.id);
    return this.base?.chat === stored.value && this.base.messages === messages ? this.base : { chat: stored.value, messages };
  }

  private verdict() {
    return this.models.store.projections.verdict(this.id) !== null;
  }

  // 다시 시도 on a chat judged stuck: the verdict's publish displays it again with the bot's regex.
  retryRegex() {
    this.models.store.projections.clear(this.id);
  }

  // Publish every completed pass, then refresh queued changes. Dropping passes overtaken by stream chunks
  // would freeze the display until generation pauses.
  refresh(): Promise<void> {
    this.again = true;
    return (this.running ??= this.drain());
  }

  private async drain() {
    try {
      while (this.again) {
        this.again = false;
        await this.pass();
      }
    } finally {
      this.running = null;
    }
  }

  private pass() {
    const evaluation = new AbortController();
    this.evaluation = evaluation;
    const judged = this.judged = this.verdict();
    const chat = this.base ? this.base.chat : this.opening.chat;
    const messages = withTurn(this.base ? this.base.messages : this.opening.messages, this.turn, this.id);
    const { store } = this.models;
    const { value, reads } = store.capture(() => {
      const places = store.scopeState(this.id) === 'loaded' ? placesOf(store, this.id, messages, this.drawings.snapshot()) : new Map<string, Set<number>>();
      return this.open.display(this.id, chat, marked(messages, places), this.screen, evaluation.signal);
    });
    this.reads = reads;
    return value.then((display) => {
      if (evaluation.signal.aborted) return;
      this.state.set({ chat, messages, ...placing(display), stuck: judged });
      // Only a visible screen's completed display may prefetch the tokenizer; account projections must not load it.
      if (this.listeners.size) store.evaluation.warm();
    }, (error: unknown) => {
      // A failure is left to the pass that follows, which may not share it.
      if (evaluation.signal.aborted || this.again || error instanceof EvaluationStopped) return;
      // The worker judged a saved chat itself; one not saved yet is judged here, on what it was displayed from. The
      // verdict's publish displays it again without the bot's regex, and a display that sticks even so fails.
      if (error instanceof EvaluationStuck && error.regex && !this.models.store.get('chat', this.id)) return this.models.store.projections.judge(this.id, this.reads);
      this.state.set({ ...this.state.snapshot(), error });
    });
  }
}
