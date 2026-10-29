import { ChangeSignal } from '../../change-signal';
import { isRecord } from '../../connectors/values';
import type { ToolEvent, ToolReach } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import type { Chat } from '../../model/chat';
import { live } from '../../model/library';
import { toolId, type Tool, type ToolUnit } from '../../model/tool';
import type { FileRef } from '../../vault/files';
import type { Down, EventName } from '../../tool-api/protocol';
import type { ScriptOutcome } from '../lua/event';
import { aborted, noOutcome, ToolStopped, ToolStuck, until, type Binding } from '../script-binding';
import type { Session } from '../session';
import type { StoreChange } from '../object-index';
import type { ObjectStore } from '../store';
import { Heartbeat } from '../worker';
import { ToolApi, header, type ToolServices } from './api';
import type { MenuItem, ToolFrames, ToolMenu, ToolPage, ToolSlot, Tools } from './facade';
import { toolFrame, type OpenFrame } from './frame';
import type { DraftTrial } from './drafts';
import { isFrameTool, ToolFailure, type Entry, type EntryCode, type EntryTrial, type Frame, type TrialWrite } from './frame-state';
import { toolsOf } from './store';

const EVENTS = new Set<EventName>(['reply', 'replying', 'sending', 'requesting', 'showing', 'prompt', 'change', 'branch', 'menu', 'action', 'input', 'settings', 'open', 'message']);
const IDLE_MS = 10 * 60_000;
const STUCK_MS = 8000;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
// A stored value as a change compares it: a file's by its id, which its bytes name, so 4 MB is never stringified.
const storedAt = (store: ObjectStore, kind: 'tooldata' | 'toolfile', id: string) => {
  if (kind === 'tooldata') { const row = store.get('tooldata', id)?.value; return row && { key: row.key, json: JSON.stringify(row.value) }; }
  const row = store.get('toolfile', id)?.value;
  return row && { key: row.key, json: row.file.id };
};
const blankEntry = (module: string, tool: Entry['tool'], code: EntryCode, data: Entry['data']): Entry => ({
  ...code, module, tool, settings: JSON.stringify(tool.settings), background: null, pages: new Set(), chats: new Set(), idle: null, data,
  chat: null, menu: [], actions: [], shown: false, slot: null, leaving: false,
});
const toolFailure = (message: unknown, line: unknown) => new ToolFailure(typeof message === 'string' ? message : 'Tool failed', Number.isSafeInteger(line) ? Number(line) : null);
const framesOf = (entry: Entry) => [...(entry.background ? [entry.background] : []), ...entry.pages];
const eventFields = (event: ToolEvent): Partial<Extract<Down, { kind: 'event' }>> => {
  switch (event.kind) {
    case 'reply': return { reply: event.reply };
    case 'replying': case 'sending': return { text: event.text };
    case 'requesting': return { messages: event.messages };
    case 'showing': return { shown: event.shown };
    case 'prompt': return { turn: event.turn };
    case 'change': return { change: event.change };
    case 'branch': return { from: event.from };
    case 'menu': return { item: event.item };
    case 'action': return { item: event.item, message: event.message };
    case 'input': return { item: event.item, text: event.text };
  }
};

export type TrialRun = (scope: ChatScope, event: ToolEvent, host: ToolReach) => Promise<{ outcome: ScriptOutcome; writes: TrialWrite[] } | null>;

export class ToolHost implements Tools, Binding<ToolUnit, ToolEvent, ToolReach> {
  private readonly entries = new Map<string, Entry>();
  // Test runs, by their own module ids, which no installed plugin has.
  private readonly trials = new Map<string, Entry>();
  private readonly code = new Map<string, Promise<string>>();
  private readonly stalls = new Map<string, number>();
  private readonly api: ToolApi;
  private readonly closing = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly signal = new ChangeSignal();
  // A new chat's settings until its first save (useChat): its tools run and list their items before it exists.
  private readonly drafts = new Map<string, Chat>();
  private shownFrames: ToolFrames = new Map();
  private ids = 0;

  constructor(private readonly session: Pick<Session, 'store' | 'files'>, private readonly services: ToolServices, private readonly open: OpenFrame = toolFrame) {
    this.api = new ToolApi(session, services, {
      allowed: (chat, module) => this.allowed(chat, module),
      publish: () => this.publish(),
      background: (entry) => this.background(entry),
      send: (frame, message) => this.send(frame, message),
      endFrame: (frame, error, closePage) => this.endFrame(frame, error, closePage),
      idle: (entry) => this.idle(entry),
    }, () => this.signal.notify());
    this.unsubscribe = session.store.subscribe((changes) => this.changed(changes));
  }

  menus(chat: string): ToolMenu[] {
    const value = this.chatValue(chat);
    return value ? this.menusOf(value) : [];
  }

  readonly menusOf = (chat: Chat): ToolMenu[] => toolsOf(this.session.store, chat).map(({ module, tool }) => ({ module, manifest: tool.manifest }));

  draft(chat: string, value: Chat): () => void {
    this.drafts.set(chat, value);
    void this.warm(chat);
    // Ended after the commit, which may register the same chat's next draft: a settings change is no reason to restart.
    return () => {
      if (this.drafts.get(chat) !== value) return;
      this.drafts.delete(chat);
      queueMicrotask(() => this.changed([]));
    };
  }

  private chatValue(chat: string): Chat | null {
    return live(this.session.store.get('chat', chat))?.value ?? this.drafts.get(chat) ?? null;
  }

  readonly items = (module: string): MenuItem[] => {
    const tool = this.session.store.get('tool', toolId(module))?.value;
    if (!tool) return [];
    return isFrameTool(tool) ? this.entries.get(module)?.menu ?? [] : tool.manifest.menu;
  };

  readonly actions = (module: string): MenuItem[] => {
    const tool = this.session.store.get('tool', toolId(module))?.value;
    if (!tool) return [];
    return isFrameTool(tool) ? this.entries.get(module)?.actions ?? [] : tool.manifest.actions ?? [];
  };

  readonly hears = (module: string, event: EventName): boolean | null => {
    if ((this.stalls.get(module) ?? 0) >= 3) return false;
    const frame = this.entries.get(module)?.background;
    return frame?.loaded ? frame.listens.has(event) : null;
  };

  readonly subscribe = (listener: () => void) => this.signal.subscribe(listener);
  readonly frames = () => this.shownFrames;
  readonly hosts = () => this.api.hosts();

  private publish() {
    this.shownFrames = new Map([...this.entries.values()].filter((entry) => isFrameTool(entry.tool)).map((entry) => [entry.module, { menu: entry.menu, actions: entry.actions, chat: entry.chat, asking: entry.shown && !entry.slot }]));
    this.signal.notify();
  }

  async warm(chat: string): Promise<void> {
    await Promise.all(this.menus(chat).map(async ({ module }) => {
      try {
        const entry = this.entry(module);
        entry.chats.add(chat);
        if (isFrameTool(entry.tool) && entry.chat !== chat) { entry.chat = chat; this.publish(); }
        await this.background(entry);
      }
      catch (error) { this.services.journal.report(chat, error, { kind: 'module', id: module }); }
    }));
  }

  async run(chat: string, unit: ToolUnit, scope: ChatScope, event: ToolEvent, host: ToolReach, signal?: AbortSignal): Promise<ScriptOutcome> {
    const entry = this.entry(unit.module);
    if (entry.file?.id !== unit.tool.file.id || !this.allowed(chat, entry.module)) throw new ToolStopped();
    entry.chats.add(chat);
    this.idle(entry);
    const frame = await until(this.background(entry), signal);
    if (!frame.listens.has(event.kind)) return noOutcome();
    return this.dispatch(frame, chat, scope, event, host, signal);
  }

  // A studio draft run on chat as no installed plugin: under its own module id, no consent, journal, stall count or stored
  // data of a plugin is touched, and its outcomes are only returned. use runs its events on one frame, so its globals and
  // storage carry from one to the next. null: the draft does not listen to that event.
  async trial<T>(chat: string, draft: DraftTrial, signal: AbortSignal, use: (run: TrialRun) => Promise<T>): Promise<T> {
    const trial: EntryTrial = { code: draft.code, chat, storage: new Map(), writes: [] };
    const entry = blankEntry(`trial:${crypto.randomUUID()}`, draft.tool, { file: null, trial }, new Map());
    this.trials.set(entry.module, entry);
    try {
      const frame = await until(this.background(entry), signal);
      return await use(async (scope, event, host) => {
        if (!frame.listens.has(event.kind)) return null;
        const outcome = await this.dispatch(frame, chat, scope, event, host, signal);
        return { outcome, writes: trial.writes.splice(0) };
      });
    } finally {
      this.end(entry, new ToolStopped());
      this.trials.delete(entry.module);
      this.stalls.delete(entry.module);
    }
  }

  private dispatch(frame: Frame, chat: string, scope: ChatScope, event: ToolEvent, host: ToolReach, signal?: AbortSignal): Promise<ScriptOutcome> {
    const { entry } = frame;
    const cancel = new AbortController();
    const stop = AbortSignal.any([cancel.signal, frame.closing.signal, ...(signal ? [signal] : [])]);
    if (stop.aborted) throw aborted(stop);
    const id = ++this.ids;
    return new Promise<ScriptOutcome>((resolve, reject) => {
      const abort = () => { frame.pending.delete(id); reject(aborted(stop)); this.idle(entry); };
      stop.addEventListener('abort', abort, { once: true });
      frame.pending.set(id, { chat, scope, host, signal: stop, cancel, resolve, reject, stop: () => stop.removeEventListener('abort', abort), event: event.kind });
      this.idle(entry);
      this.send(frame, { kind: 'event', id, event: event.kind, chat: header(chat, scope), ...eventFields(event) });
    });
  }

  page(module: string, page: ToolPage): () => void {
    let frame: Frame;
    try {
      const entry = this.entry(module);
      if (!entry.tool.manifest.page || (page.chat !== null && !this.allowed(page.chat, module))) throw new ToolStopped();
      if (page.chat !== null) entry.chats.add(page.chat);
      frame = this.frame(entry, page);
      entry.pages.add(frame);
      this.idle(entry);
      void frame.ready.catch((error: unknown) => this.services.journal.report(page.chat ?? '', error, { kind: 'module', id: module }));
    } catch (error) {
      this.services.journal.report(page.chat ?? '', error, { kind: 'module', id: module });
      page.close();
      return () => {};
    }
    return () => { this.endFrame(frame, new ToolStopped()); this.idle(frame.entry); };
  }

  // The frame is shown over slot while it asks to be; a slot attached while it does not is the user opening its page.
  attach(module: string, slot: ToolSlot): () => void {
    let entry: Entry;
    try {
      entry = this.entry(module);
      if (!isFrameTool(entry.tool) || (slot.chat !== null && !this.allowed(slot.chat, module))) throw new ToolStopped();
    } catch (error) {
      this.services.journal.report(slot.chat ?? '', error, { kind: 'module', id: module });
      slot.close();
      return () => {};
    }
    if (slot.chat !== null) { entry.chats.add(slot.chat); entry.chat = slot.chat; }
    if (entry.leaving) { entry.leaving = false; entry.shown = true; }
    const previous = entry.slot;
    entry.slot = slot;
    previous?.place(null);
    previous?.close();
    this.idle(entry);
    this.publish();
    void this.background(entry).then((frame) => {
      if (entry.slot !== slot) return;
      if (entry.shown) slot.place(frame.connection.frame);
      else this.send(frame, { kind: 'open' });
    }, (error: unknown) => this.services.journal.report(slot.chat ?? '', error, { kind: 'module', id: module }));
    return () => {
      if (entry.slot !== slot) return;
      entry.slot = null;
      slot.place(null);
      // A slot replaced within the same commit is a remount (StrictMode, a resize across layouts), not the user closing
      // it. shown drops now, so no other tool's panel is pushed aside meanwhile, and a remount restores it.
      if (entry.shown) {
        entry.leaving = true;
        queueMicrotask(() => { entry.leaving = false; });
      }
      entry.shown = false;
      this.idle(entry);
      this.publish();
    };
  }

  private settingsChanged(entry: Entry, tool: Tool) {
    const settings = JSON.stringify(tool.settings);
    if (settings === entry.settings) return;
    entry.settings = settings;
    entry.tool = tool;
    if (entry.background?.loaded) this.send(entry.background, { kind: 'settings', values: tool.settings });
    this.idle(entry);
  }

  close() {
    this.closing.abort();
    this.unsubscribe();
    for (const entry of [...this.entries.values()]) this.end(entry, new ToolStopped());
    this.signal.clear();
    this.api.close();
    this.code.clear();
  }

  private allowed(chat: string, module: string): boolean {
    const trial = this.trials.get(module)?.trial;
    if (trial) return trial.chat === chat;
    const value = this.chatValue(chat);
    return !!value && toolsOf(this.session.store, value).some((unit) => unit.module === module);
  }

  private entry(module: string): Entry {
    if (this.closing.signal.aborted) throw new ToolStopped();
    if ((this.stalls.get(module) ?? 0) >= 3) throw new ToolStuck(true);
    const { store } = this.session;
    const tool = store.get('tool', toolId(module))?.value;
    if (!tool || !live(store.get('module', module))) throw new ToolStopped();
    const current = this.entries.get(module);
    if (current) return current;
    const entry = blankEntry(module, tool, { file: tool.file, trial: null }, new Map((['tooldata', 'toolfile'] as const).flatMap((kind) => store.children(kind, module).map(({ id }) => [id, storedAt(store, kind, id)!] as const))));
    this.entries.set(module, entry);
    return entry;
  }

  private async background(entry: Entry): Promise<Frame> {
    const frame = entry.background ??= this.frame(entry);
    await frame.ready;
    return frame;
  }

  private frame(entry: Entry, page?: ToolPage): Frame {
    const network = !page && isFrameTool(entry.tool) && this.api.networkOn(entry);
    const connection = this.open(page ? { role: 'page', page } : isFrameTool(entry.tool) ? { role: 'frame', network } : { role: 'background' });
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const lease = page?.chat ? this.session.store.retainChat(page.chat) : null;
    const frame: Frame = {
      id: ++this.ids, entry, connection, page, closing: new AbortController(),
      heart: new Heartbeat(() => this.send(frame, { kind: 'ping' }), () => this.stalled(frame)),
      loaded: false, ready, resolve, reject, loadTimer: null,
      listens: new Set(), pending: new Map(), calls: new Map(), messages: [], reading: Promise.resolve(), lanes: new Set(), release: () => lease?.release(), network,
      unloading: false,
    };
    connection.port.onmessage = ({ data }: MessageEvent<unknown>) => this.receive(frame, data);
    connection.port.start();
    void Promise.all([connection.ready, entry.trial ? entry.trial.code : this.source(entry.file), lease?.ready]).then(([, code, failure]) => {
      if (failure) throw new Error(failure.error);
      if (frame.closing.signal.aborted) return;
      const context = page?.chat ? this.services.pages.pageContext(page.chat, entry.module, frame.closing.signal) : null;
      if (page?.chat && !context) throw new ToolStopped();
      frame.loadTimer = setTimeout(() => this.stalled(frame), STUCK_MS);
      frame.heart.start(STUCK_MS);
      this.send(frame, { kind: 'load', api: 1, role: page ? 'page' : isFrameTool(entry.tool) ? 'frame' : 'background', code, manifest: entry.tool.manifest, settings: entry.tool.settings, chat: context ? header(page!.chat!, context.scope) : null, theme: page?.theme ?? 'dark' });
    }).catch((error: unknown) => this.endFrame(frame, error instanceof Error ? error : new Error(String(error)), true));
    return frame;
  }

  private source(file: FileRef): Promise<string> {
    const held = this.code.get(file.id);
    if (held) return held;
    const reading = this.session.files.read(file, { signal: this.closing.signal }).then((read) => {
      if (!read.ok) throw new Error(`Tool file: ${read.error}`);
      return new TextDecoder('utf-8', { fatal: true }).decode(read.data);
    }).catch((error: unknown) => { this.code.delete(file.id); throw error; });
    this.code.set(file.id, reading);
    return reading;
  }

  private receive(frame: Frame, data: unknown) {
    if (!isRecord(data) || (frame.closing.signal.aborted && !(frame.unloading && data.kind === 'call'))) return;
    if (data.kind === 'pong') { frame.heart.answered(); return; }
    if (data.kind === 'loaded' && frame.loadTimer === null && frame.loaded && Array.isArray(data.listens) && data.listens.every((event) => EVENTS.has(event as EventName))) {
      // A listener added after load (sandbox/api.ts sends the whole list again).
      frame.listens = new Set(data.listens as EventName[]);
      return;
    }
    if (data.kind === 'loaded' && !frame.loaded && frame.loadTimer !== null && Array.isArray(data.listens) && data.listens.every((event) => EVENTS.has(event as EventName))) {
      frame.listens = new Set(data.listens as EventName[]);
      frame.loaded = true;
      clearTimeout(frame.loadTimer);
      frame.loadTimer = null;
      this.stalls.delete(frame.entry.module);
      frame.resolve();
      this.idle(frame.entry);
      return;
    }
    if (data.kind === 'load-failed' && typeof data.message === 'string') { this.endFrame(frame, toolFailure(data.message, data.line), true); return; }
    if (data.kind === 'call' && Number.isSafeInteger(data.call) && Number(data.call) > 0 && typeof data.method === 'string' && Array.isArray(data.args)) {
      const call = Number(data.call);
      if (frame.calls.has(call)) return;
      if (frame.calls.size >= 128) { this.send(frame, { kind: 'answer', call, ok: false, value: 'too-many-calls' }); return; }
      const cancel = new AbortController();
      frame.calls.set(call, cancel);
      void this.api.call(frame, data.method, data.args, data.event, cancel.signal).then(
        (value) => this.send(frame, { kind: 'answer', call, ok: true, value }),
        (error: unknown) => this.send(frame, { kind: 'answer', call, ok: false, value: describe(error) }),
      ).finally(() => frame.calls.delete(call));
      return;
    }
    if (data.kind === 'cancel' && Number.isSafeInteger(data.call)) { frame.calls.get(Number(data.call))?.abort(); return; }
    if (data.kind === 'done' || data.kind === 'failed') {
      const id = Number(data.id);
      if (!Number.isSafeInteger(data.id)) return;
      if (id === 0) {
        if (frame.entry.trial) return;
        if (data.kind === 'failed' && typeof data.message === 'string') this.services.journal.report(this.api.chatOf(frame) ?? '', new Error(data.message), { kind: 'module', id: frame.entry.module });
        else if (data.kind === 'done' && this.api.chatOf(frame)) {
          void this.api.pageWrite(frame, data.outcome).then(
            () => this.send(frame, { kind: 'answer', call: 0, ok: true, value: null }),
            (error: unknown) => this.send(frame, { kind: 'answer', call: 0, ok: false, value: describe(error) }),
          );
        }
        return;
      }
      const pending = frame.pending.get(id);
      if (!pending) return;
      if (data.kind === 'failed') { this.settle(frame, id, toolFailure(data.message, data.line)); return; }
      void this.api.convert(frame, pending, data.outcome).then((outcome) => this.settle(frame, id, outcome), (error: unknown) => this.settle(frame, id, error instanceof Error ? error : new Error(String(error))));
    }
  }

  private settle(frame: Frame, id: number, result: ScriptOutcome | Error) {
    const pending = frame.pending.get(id);
    if (!pending) return;
    frame.pending.delete(id);
    pending.stop();
    pending.cancel.abort(result instanceof Error ? result : new ToolStopped());
    if (result instanceof Error) pending.reject(result);
    else if (!this.allowed(pending.chat, frame.entry.module)) pending.reject(new ToolStopped());
    else pending.resolve(result);
    this.idle(frame.entry);
  }

  private send(frame: Frame, message: Down) { if (!frame.closing.signal.aborted || frame.unloading) frame.connection.port.postMessage(message); }

  private idle(entry: Entry) {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = null;
    // A frame tool lives while a chat is open for it or its page shows it.
    if (entry.pages.size || entry.slot || entry.chat !== null || framesOf(entry).some((frame) => frame.pending.size)) return;
    entry.idle = setTimeout(() => this.end(entry, new ToolStopped()), IDLE_MS);
  }

  private stalled(frame: Frame) {
    if (frame.closing.signal.aborted) return;
    this.stalls.set(frame.entry.module, (this.stalls.get(frame.entry.module) ?? 0) + 1);
    const error = new ToolStuck(this.stalls.get(frame.entry.module)! >= 3);
    if (frame.loaded && !frame.entry.trial && !framesOf(frame.entry).some((each) => each.pending.size)) this.services.journal.report([...frame.entry.chats].at(-1) ?? '', error, { kind: 'module', id: frame.entry.module });
    this.end(frame.entry, error);
  }

  private endFrame(frame: Frame, error: Error, closePage = false) {
    if (frame.closing.signal.aborted) return;
    frame.closing.abort(error);
    if (frame.loadTimer !== null) clearTimeout(frame.loadTimer);
    frame.heart.rest();
    frame.unloading = true;
    void frame.connection.close().then(() => {
      frame.unloading = false;
      frame.connection.port.onmessage = null;
    });
    frame.reject(error);
    for (const pending of frame.pending.values()) { pending.stop(); pending.reject(error); }
    frame.pending.clear();
    frame.release();
    for (const chat of frame.lanes) this.session.store.evaluation.forget({ asker: 'tool', chat, tool: `${frame.entry.module}:${frame.id}` });
    frame.entry.pages.delete(frame);
    if (frame.entry.background === frame) {
      frame.entry.background = null;
      frame.entry.menu = [];
      frame.entry.actions = [];
      frame.entry.shown = false;
      if (frame.entry.slot) {
        const { slot } = frame.entry;
        frame.entry.slot = null;
        slot.place(null);
        slot.close();
      }
      this.publish();
    }
    if (closePage) frame.page?.close();
  }

  private end(entry: Entry, error: Error) {
    if (entry.idle) clearTimeout(entry.idle);
    for (const frame of framesOf(entry)) this.endFrame(frame, error, true);
    this.api.cancel(entry.module);
    if (this.entries.get(entry.module) === entry) this.entries.delete(entry.module);
    this.publish();
  }

  private changed(changes: readonly StoreChange[]) {
    for (const entry of [...this.entries.values()]) {
      const tool = this.session.store.get('tool', toolId(entry.module))?.value;
      if (!tool || !live(this.session.store.get('module', entry.module)) || tool.file.id !== entry.file?.id || JSON.stringify(tool.manifest) !== JSON.stringify(entry.tool.manifest)) { this.end(entry, new ToolStopped()); continue; }
      // A withdrawn network answer cannot wait for the frame's next start: its CSP still lets pictures out.
      if (framesOf(entry).some((frame) => frame.network) && !this.api.networkOn(entry)) { this.end(entry, new ToolStopped()); continue; }
      // A consent given while it runs restarts a frame no slot shows, for its pictures from outside; one shown keeps its
      // sandbox to its next start rather than close under the user.
      if (entry.background && !entry.background.network && !entry.slot && !entry.pages.size && isFrameTool(entry.tool) && this.api.networkOn(entry)) {
        const { chat } = entry;
        this.end(entry, new ToolStopped());
        if (chat) void this.warm(chat);
        continue;
      }
      this.settingsChanged(entry, tool);
      const keys = new Set<string>();
      for (const change of changes) {
        if ((change.kind !== 'tooldata' && change.kind !== 'toolfile') || change.parent !== entry.module) continue;
        const previous = entry.data.get(change.id);
        const current = storedAt(this.session.store, change.kind, change.id);
        if (current?.json === previous?.json && current?.key === previous?.key) continue;
        if (previous) keys.add(previous.key);
        if (current) { keys.add(current.key); entry.data.set(change.id, current); }
        else entry.data.delete(change.id);
      }
      if (keys.size) {
        for (const frame of framesOf(entry)) this.send(frame, { kind: 'storage', keys: [...keys] });
        this.idle(entry);
      }
      for (const frame of framesOf(entry)) {
        for (const [id, pending] of frame.pending) if (!this.allowed(pending.chat, entry.module)) this.settle(frame, id, new ToolStopped());
        if (frame.page?.chat && !this.allowed(frame.page.chat, entry.module)) this.endFrame(frame, new ToolStopped(), true);
      }
      if (entry.chat !== null && !this.allowed(entry.chat, entry.module)) { entry.chat = null; this.publish(); }
      if (entry.chats.size && !entry.pages.size && !entry.slot && ![...entry.chats].some((chat) => this.allowed(chat, entry.module))) this.end(entry, new ToolStopped());
    }
  }
}

export type ToolRunner = Tools & Binding<ToolUnit, ToolEvent, ToolReach> & Pick<ToolHost, 'trial'>;
export const createTools = (session: Pick<Session, 'store' | 'files'>, services: ToolServices): ToolRunner => new ToolHost(session, services);
