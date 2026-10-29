import type { HttpRequest } from '../../connectors/types';
import { isRecord } from '../../connectors/values';
import { RELAY_HEADER } from '../../contracts/http';
import { Runaway } from '../../engine/cbs/evaluate';
import { DEFAULT_ORDER } from '../../engine/import/convert';
import { fieldValue, TOOL_ACTION_CHARS, TOOL_ACTIONS } from '../../engine/import/tool';
import type { ToolEvent, ModelMessage, Question } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import { live } from '../../model/library';
import { SETTINGS_ID } from '../../model/settings';
import { toolId } from '../../model/tool';
import { TOOL_VARIABLES, toolVar, type Json } from '../../tool-api/manifest';
import type { ChatHeader, Down, Message, ToolOutcome } from '../../tool-api/protocol';
import { RISU_DECLINED } from '../../tool-api/risu-methods';
import { limitsOf, packsOf } from '../chat-context';
import type { ToolState } from '../evaluation-core';
import { changedTail } from '../history-delta';
import { attachIllustration } from '../illustrate';
import type { ScriptOutcome } from '../lua/event';
import { chatPersona } from '../personas';
import { noOutcome, ToolStopped } from '../script-binding';
import type { ScriptPages } from '../script-pages';
import type { ScriptJournal } from '../script-journal';
import type { Session } from '../session';
import type { MenuItem, ToolHosts } from './facade';
import { isFrameTool, type Context, type Entry, type EntryTrial, type Frame } from './frame-state';
import { decodeState, encodeState } from './state';
import { readToolAsset, saveToolAsset, setToolSettings, toolChatData, toolChatKeys, toolKeys, ToolStorage } from './store';

// The sandbox refuses story changes in these too (sandbox/api.ts); a page that posts its own outcome is not trusted to.
const STORY_LOCKED = new Set<ToolEvent['kind']>(['change', 'branch', 'replying', 'sending', 'requesting', 'showing']);
const isMenu = (value: unknown): value is MenuItem[] => Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string');

function isJson(value: unknown): value is Json {
  try { JSON.stringify(value); } catch { return false; }
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (next === null || typeof next === 'string' || typeof next === 'boolean') continue;
    if (typeof next === 'number' && Number.isFinite(next)) continue;
    if (typeof next !== 'object' || !next || (!Array.isArray(next) && Object.getPrototypeOf(next) !== Object.prototype && Object.getPrototypeOf(next) !== null)) return false;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const value of Object.values(next)) pending.push(value);
  }
  return true;
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) return false;
  if (value.kind === 'input' || value.kind === 'confirm') return typeof value.text === 'string';
  return value.kind === 'select' && (value.text === undefined || typeof value.text === 'string') && Array.isArray(value.options) && value.options.every((option) => typeof option === 'string');
}
function isModelMessages(value: unknown): value is ModelMessage[] {
  return Array.isArray(value) && value.every((message) => isRecord(message) && (message.role === 'system' || message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
}
// The relay's envelope, less the URL: GET or POST, text headers, and a text body only with POST.
function isRequest(value: unknown): value is Omit<HttpRequest, 'url'> {
  return isRecord(value) && (value.method === 'GET' || value.method === 'POST') && isRecord(value.headers) && Object.values(value.headers).every((each) => typeof each === 'string')
    && (value.body === null || (value.method === 'POST' && typeof value.body === 'string'));
}
const isPairs = (value: unknown) => Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (pair[1] === undefined || isJson(pair[1])));
const isText = (value: unknown) => value === undefined || value === null || typeof value === 'string';
function isAnswer(value: unknown): value is Hazelle.PromptAnswer | undefined {
  if (isText(value)) return true;
  if (!isRecord(value) || !isText(value.tool)) return false;
  return value.memory === undefined || (isRecord(value.memory) && typeof value.memory.text === 'string' && (value.memory.through === null || typeof value.memory.through === 'string'));
}
const isRequestMessages = (value: unknown): value is Hazelle.RequestMessage[] => Array.isArray(value) && value.every((message) => isModelMessages([message])
  && (message.message === undefined || typeof message.message === 'string') && (message.cache === undefined || message.cache === true));
const answers = (event: ToolEvent['kind'] | undefined, value: unknown) => {
  if (value === undefined) return true;
  switch (event) {
    case 'prompt': return isAnswer(value);
    case 'replying': case 'sending': case 'input': case 'tool': return typeof value === 'string';
    case 'requesting': return isRequestMessages(value);
    case 'showing': return Array.isArray(value) && value.every((text) => typeof text === 'string');
    default: return false;
  }
};
function isOutcome(value: unknown, event: ToolEvent['kind'] | undefined): value is ToolOutcome {
  return isRecord(value) && answers(event, value.value) && isPairs(value.writes) && isPairs(value.data)
    && Array.isArray(value.edits) && value.edits.every((edit) => isRecord(edit) && Number.isInteger(edit.index) && typeof edit.text === 'string')
    && Array.isArray(value.added) && value.added.every((item) => isRecord(item) && (item.role === 'user' || item.role === 'char') && typeof item.text === 'string')
    && Array.isArray(value.badges) && value.badges.every((badge) => isRecord(badge) && Number.isInteger(badge.index) && (badge.text === null || typeof badge.text === 'string'))
    && Array.isArray(value.lore) && value.lore.every((entry) => isRecord(entry) && typeof entry.name === 'string' && Array.isArray(entry.keys) && entry.keys.every((key) => typeof key === 'string')
      && typeof entry.text === 'string' && typeof entry.always === 'boolean' && typeof entry.on === 'boolean')
    && Array.isArray(value.variables) && value.variables.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && !pair[0].startsWith(TOOL_VARIABLES) && typeof pair[1] === 'string');
}
// A test run's calls that would write outside its outcome: storage and settings change its own copy, the rest are
// refused, each listed. null: the call runs as in any run, which reads what the run's own module holds: nothing.
function trialCall(entry: Entry, trial: EntryTrial, method: string, first: unknown, second: unknown): { answer: unknown } | null {
  switch (method) {
    case 'storage.get': if (typeof first !== 'string') break; return { answer: trial.storage.get(first) };
    case 'storage.keys': return { answer: [...trial.storage.keys()] };
    case 'storage.set': case 'storage.delete': {
      if (typeof first !== 'string' || (method === 'storage.set' && !isJson(second))) break;
      const value = method === 'storage.set' ? second as Json : undefined;
      if (value === undefined) trial.storage.delete(first);
      else trial.storage.set(first, value);
      trial.writes.push({ kind: 'storage', key: first, value });
      return { answer: undefined };
    }
    case 'settings': return { answer: entry.tool.settings };
    case 'settings.set': {
      const field = entry.tool.manifest.settings.find(({ key }) => key === first);
      if (!field || !fieldValue(field, second)) break;
      entry.tool = { ...entry.tool, settings: { ...entry.tool.settings, [field.key]: second } };
      trial.writes.push({ kind: 'setting', key: field.key, value: second });
      return { answer: undefined };
    }
    case 'assets.save': case 'chat.picture': case 'chat.send':
      trial.writes.push({ kind: 'refused', call: method });
      throw new Error('Not run in a test');
    default: return null;
  }
  // Never on to the store-backed calls, which would write.
  throw new Error('Invalid tool call');
}
// The fields a tool writes, over a new entry's defaults; upsertChatLore keeps the folder of the one it replaces.
const chatLore = ({ name, keys, text, always, on }: ToolOutcome['lore'][number]): ScriptOutcome['lore'][number] => ({
  name, keys, secondaryKeys: [], content: text, enabled: on, constant: always, selective: false, useRegex: false, caseSensitive: false,
  insertionOrder: DEFAULT_ORDER, priority: null, position: null,
});
function cardOf(character: string | null, scope: ChatScope): Hazelle.Card | null {
  const { card } = scope;
  if (!card || character === null) return null;
  return { id: character, name: card.name, description: card.description, personality: card.personality, scenario: card.scenario, greeting: card.greetings[0] ?? null, creatorNotes: card.creatorNotes, tags: card.tags };
}
// scope.lore holds only the character's, the cast's, the chat's own and the on modules' entries.
function lorebookOf(chat: string, character: string | null, scope: ChatScope): Hazelle.LoreEntry[] {
  const cast = new Set(scope.cast.map(({ id }) => id));
  const kind = (parent: string) => parent === character ? 'character' : parent === chat ? 'chat' : cast.has(parent) ? 'cast' : 'module';
  return scope.lore.map(({ parent, value }) => ({ name: value.name, keys: value.keys, text: value.content, always: value.constant, on: value.enabled, owner: { kind: kind(parent!), id: parent! } }));
}
export const header = (chat: string, scope: ChatScope): ChatHeader => ({ id: chat, character: scope.card && { name: scope.card.name, description: scope.card.description }, persona: scope.persona, length: scope.messages.length - (scope.greeting === null ? 0 : 1) });

export type ToolServices = { pages: Pick<ScriptPages, 'pageContext' | 'pageWrite' | 'send' | 'rendered'>; journal: Pick<ScriptJournal, 'report'> };

type FrameRuntime = {
  allowed(chat: string, module: string): boolean;
  publish(): void;
  background(entry: Entry): Promise<Frame>;
  send(frame: Frame, message: Down): void;
  endFrame(frame: Frame, error: Error, closePage?: boolean): void;
  idle(entry: Entry): void;
};

export class ToolApi {
  private readonly storage: ToolStorage;
  private called: ToolHosts = new Map();

  constructor(private readonly session: Pick<Session, 'store' | 'files'>, private readonly services: ToolServices, private readonly runtime: FrameRuntime, private readonly notify: () => void) {
    this.storage = new ToolStorage(session);
  }

  readonly hosts = () => this.called;

  close() { this.storage.close(); }

  cancel(module: string) { this.storage.cancel(module); }

  private context(frame: Frame, event: unknown): Context {
    if (event !== undefined) {
      const pending = typeof event === 'number' ? frame.pending.get(event) : null;
      if (!pending || !this.runtime.allowed(pending.chat, frame.entry.module)) throw new ToolStopped();
      return pending;
    }
    const chat = this.chatOf(frame);
    const context = chat && this.services.pages.pageContext(chat, frame.entry.module, frame.closing.signal);
    if (!context || !chat) throw new Error('no-chat');
    return { ...context, chat, signal: frame.closing.signal };
  }

  // The chat a page or a frame tool's calls outside an event act on.
  chatOf(frame: Frame): string | null {
    return frame.page ? frame.page.chat : frame.entry.background === frame && isFrameTool(frame.entry.tool) ? frame.entry.chat : null;
  }

  async call(frame: Frame, method: string, args: unknown[], event: unknown, cancel: AbortSignal): Promise<unknown> {
    const entry = frame.entry;
    if (!entry.trial && !live(this.session.store.get('module', entry.module))) throw new ToolStopped();
    const [first, second] = args;
    if (entry.trial) {
      const kept = trialCall(entry, entry.trial, method, first, second);
      if (kept) return kept.answer;
    }
    const own = !frame.page && isFrameTool(entry.tool);
    switch (method) {
      case 'frame.chat': {
        if (!own) break;
        const chat = this.chatOf(frame);
        const context = chat && this.services.pages.pageContext(chat, entry.module, frame.closing.signal);
        return context ? header(chat, context.scope) : null;
      }
      case 'frame.show':
        if (!own) break;
        entry.shown = true;
        entry.slot?.place(frame.connection.frame);
        this.runtime.publish();
        return;
      case 'frame.hide':
        if (!own) break;
        entry.shown = false;
        entry.slot?.place(null);
        entry.slot?.close();
        this.runtime.publish();
        return;
      case 'frame.menu':
        if (!own || !isMenu(first)) break;
        entry.menu = first.map(({ id, label }) => ({ id, label }));
        this.runtime.publish();
        return;
      case 'frame.actions':
        if (!own || !isMenu(first)) break;
        if (first.length > TOOL_ACTIONS || first.some(({ label }) => [...label].length > TOOL_ACTION_CHARS)) throw new Error(`At most ${TOOL_ACTIONS} message actions, each named in ${TOOL_ACTION_CHARS} characters`);
        entry.actions = first.map(({ id, label }) => ({ id, label }));
        this.runtime.publish();
        return;
      case 'frame.missing': {
        if (!own || typeof first !== 'string') break;
        const from = { kind: 'module', id: entry.module } as const;
        const log = { stage: 'call', pack: from, script: entry.tool.manifest.displayName, at: Date.now(), duration: 0, logs: [], writes: [], errors: [], missing: [first], stopped: false, changed: false, handled: false, truncated: false };
        // A declined name is told when read, which a plugin's typeof guard does too: 점검 lists it, no toast, since a
        // guard is not a failure and a call to it fails as an error anyway.
        this.services.journal.report(entry.chat ?? '', { errors: [], missing: RISU_DECLINED.has(first) ? [] : [first], trace: { entries: [log], omitted: 0 } }, from);
        return;
      }
      case 'storage.get': if (typeof first === 'string') return this.storage.read(entry.module, first); break;
      case 'storage.keys': return toolKeys(this.session.store, entry.module);
      case 'storage.set': if (typeof first === 'string' && isJson(second)) return this.storage.write(entry.module, first, second); break;
      case 'storage.delete': if (typeof first === 'string') return this.storage.write(entry.module, first, undefined); break;
      case 'assets.save': {
        if (!(first instanceof Uint8Array)) break;
        this.storage.take(entry.module);
        const saved = await saveToolAsset(this.session.store, this.session.files, entry.module, new Uint8Array(first));
        if (!saved.ok) throw new Error(saved.error);
        return saved.data;
      }
      case 'assets.read': {
        if (typeof first !== 'string') break;
        const read = await readToolAsset(this.session.store, this.session.files, entry.module, first);
        if (!read.ok) throw new Error(read.error);
        return read.data;
      }
      case 'chat.picture': {
        const [, at, bytes, caption] = args;
        if (typeof first !== 'string' || !isRecord(at) || typeof at.id !== 'string' || typeof at.version !== 'string' || !(bytes instanceof Uint8Array) || (caption !== null && typeof caption !== 'string')) break;
        if (!this.runtime.allowed(first, entry.module)) throw new ToolStopped();
        this.storage.take(entry.module);
        const tool = { module: entry.module, name: live(this.session.store.get('module', entry.module))!.value.name };
        const saved = await attachIllustration(this.session, first, tool, { message: at.id, version: at.version }, new Uint8Array(bytes), caption);
        if (!saved.ok) throw new Error(saved.error);
        return;
      }
      case 'chat.send': {
        if (typeof first !== 'string' || typeof second !== 'string') break;
        if (!this.runtime.allowed(first, entry.module)) throw new ToolStopped();
        if (!entry.tool.manifest.uses.includes('model')) return { ok: false, reason: 'not-declared' } satisfies Hazelle.SendAnswer;
        return this.services.pages.send(first, second, { kind: 'module', id: entry.module }, AbortSignal.any([frame.closing.signal, cancel]));
      }
      case 'chat.rendered': {
        const at = second === null ? null : isRecord(second) && typeof second.id === 'string' && typeof second.version === 'string' ? { id: second.id, version: second.version } : undefined;
        if (typeof first !== 'string' || at === undefined) break;
        if (!this.runtime.allowed(first, entry.module)) throw new ToolStopped();
        return this.services.pages.rendered(first, at);
      }
      case 'settings': return this.session.store.get('tool', toolId(entry.module))!.value.settings;
      case 'settings.set': {
        const field = entry.tool.manifest.settings.find(({ key }) => key === first);
        if (!field || !fieldValue(field, second)) break;
        this.storage.take(entry.module);
        const saved = await setToolSettings(this.session, entry.module, { [field.key]: second });
        if (!saved.ok) throw new Error(saved.error);
        return;
      }
      case 'account': {
        const { store } = this.session;
        const current = store.get('settings', SETTINGS_ID)?.value.persona;
        return {
          personas: store.list('persona').flatMap((each) => live(each) ? [{ id: each.id, name: each.value.name, description: each.value.description, current: each.id === current }] : []),
          characters: store.list('character').flatMap((each) => live(each) ? [{ id: each.id, name: each.value.card.name }] : []),
        } satisfies Hazelle.Account;
      }
      case 'post':
        if (isJson(first)) {
          if (frame.page) this.runtime.send(await this.runtime.background(entry), { kind: 'message', data: first });
          else for (const page of entry.pages) this.runtime.send(page, { kind: 'message', data: first });
          return;
        }
        break;
      case 'page.close': if (frame.page) { this.runtime.endFrame(frame, new ToolStopped(), true); this.runtime.idle(entry); return; } break;
      default: {
        const context = this.context(frame, event);
        const owner = { kind: 'module', id: entry.module } as const;
        if (method === 'chat.messages') {
          const state = await this.state(frame, context);
          const greeting = context.scope.greeting === null ? 0 : 1;
          const messages: Message[] = context.scope.messages.slice(greeting).map((message, index) => ({ index, id: message.message, version: message.id, role: message.role === 'user' ? 'user' : 'char', text: state.texts[index + greeting]!, raw: message.text, time: message.time ?? 0 }));
          const tail = changedTail(frame.messages, messages, (a, b) => a.id === b.id && a.version === b.version && a.role === b.role && a.text === b.text && a.raw === b.raw && a.time === b.time);
          frame.messages = messages;
          return tail;
        }
        if (method === 'chat.card') return cardOf(live(this.session.store.get('chat', context.chat))?.value.character ?? null, context.scope);
        if (method === 'chat.lorebook') return lorebookOf(context.chat, live(this.session.store.get('chat', context.chat))?.value.character ?? null, context.scope);
        if (method === 'chat.setup') {
          const { store } = this.session;
          const chat = live(store.get('chat', context.chat))!.value;
          const persona = chatPersona(store, chat);
          return {
            persona: persona.kind === 'persona' ? persona.persona.id : null,
            limits: limitsOf(store, chat),
            modules: packsOf(store, chat).flatMap(({ id, module }) => module ? [{ id, name: store.get('module', id)!.value.name }] : []),
          } satisfies Hazelle.Setup;
        }
        if (method === 'chat.greeting') return context.scope.greeting === null ? null : (await this.state(frame, context)).texts[0]!;
        if (method === 'chat.state.get' && typeof first === 'string') return decodeState(new Map((await this.state(frame, context)).variables).get(toolVar(entry.tool.manifest, first)));
        if (method === 'chat.variables.get' && typeof first === 'string' && !first.startsWith(TOOL_VARIABLES)) return new Map((await this.state(frame, context)).variables).get(first);
        if (method === 'chat.data.get' && typeof first === 'string') return toolChatData(this.session.store, entry.module, context.chat, first);
        if (method === 'chat.data.keys') return toolChatKeys(this.session.store, entry.module, context.chat);
        if (method === 'embed' && Array.isArray(first) && first.every((text) => typeof text === 'string') && (second === null || second === 'query' || second === 'document')) {
          if (!entry.tool.manifest.uses.includes('embed')) return { ok: false, reason: 'not-declared' };
          return context.host.embed(first as string[], second, owner, context.signal);
        }
        if (method === 'model' && (first === 'main' || first === 'aux') && isModelMessages(second)) {
          if (!entry.tool.manifest.uses.includes('model')) return { ok: false, reason: 'not-declared' };
          const result = await context.host.model(first, second.map(({ role, content }) => ({ role, content })), owner, context.signal);
          return result.success ? { ok: true, text: result.result } : { ok: false, reason: result.reason };
        }
        if (method === 'fetch' && typeof first === 'string' && URL.canParse(first) && isRequest(second)) {
          if (!entry.tool.manifest.uses.includes('network')) return { ok: false, reason: 'not-declared' } satisfies Hazelle.FetchAnswer;
          return this.fetch(entry, context, { url: first, ...second }, cancel);
        }
        if (method === 'tokens' && typeof first === 'string') return context.host.tokens(first);
        if (method === 'lore' && (first === null || typeof first === 'number' && Number.isFinite(first) && first >= 0)) return context.host.lore(first);
        if (method === 'ask' && isQuestion(first)) return context.host.ask(first, owner, context.signal);
        if (method === 'say' && (first === 'normal' || first === 'error') && typeof second === 'string') return context.host.say(first, second, owner);
      }
    }
    throw new Error('Invalid tool call');
  }

  private async fetch(entry: Entry, context: Context, request: HttpRequest, cancel: AbortSignal): Promise<Hazelle.FetchAnswer> {
    const signal = AbortSignal.any([context.signal, cancel]);
    const result = await context.host.fetch(request, entry.module, signal);
    if (result.ok || (result.reason !== 'not-allowed' && result.reason !== 'stopped')) this.tally(entry.module, new URL(request.url).hostname);
    if (!result.ok) return result;
    const { response } = result;
    try {
      return { ok: true, status: response.status, headers: [...response.headers].filter(([name]) => name !== RELAY_HEADER), body: await response.arrayBuffer() };
    } catch {
      return { ok: false, reason: signal.aborted ? 'stopped' : 'offline' };
    }
  }

  private tally(module: string, host: string) {
    const hosts = new Map(this.called.get(module));
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    this.called = new Map([...this.called, [module, hosts]]);
    this.notify();
  }

  networkOn(entry: Entry): boolean {
    return entry.tool.manifest.uses.includes('network') && live(this.session.store.get('module', entry.module))?.value.network === true;
  }

  private state(frame: Frame, context: Context): Promise<ToolState> {
    if (context.state) return context.state;
    const lane = { asker: 'tool', chat: context.chat, tool: `${frame.entry.module}:${frame.id}` } as const;
    frame.lanes.add(context.chat);
    // Concurrent events have immutable snapshots but one ordered changed-tail transport per frame.
    const reading = frame.reading.catch(() => {}).then(async () => {
      const state = await this.session.store.evaluation.state(lane, context.scope, '', context.signal);
      if ('kind' in state) throw new Runaway();
      return state;
    });
    frame.reading = reading.catch(() => {});
    context.state = reading;
    return reading;
  }

  async convert(frame: Frame, context: Context, value: unknown): Promise<ScriptOutcome> {
    if (!isOutcome(value, context.event)) throw new Error('Invalid tool outcome');
    const greeting = context.scope.greeting === null ? 0 : 1;
    const edits = value.edits.filter(({ index }) => index >= 0 && index < context.scope.messages.length - greeting);
    const state = edits.length ? await this.state(frame, context) : null;
    const data = [...new Map(value.data)];
    const badges = [...new Map(value.badges.map(({ index, text }) => [index, text]))].map(([index, text]) => ({ index, text }));
    // A page's write takes its share of the write rate before it is converted (pageWrite).
    if (context.event && (data.length || badges.length || value.lore.length)) this.storage.take(frame.entry.module);
    const story = context.event && STORY_LOCKED.has(context.event) ? { edits: [], added: [] } : { edits: edits.map((edit) => ({ ...edit, wrote: state!.wrote[edit.index + greeting]! })), added: value.added.map((item) => ({ ...item, before: null })) };
    return { ...noOutcome(), value: value.value, handled: true, writes: [...[...new Map(value.writes)].map(([key, json]): [string, string] => [toolVar(frame.entry.tool.manifest, key), encodeState(json)]), ...new Map(value.variables)], ...story, lore: value.lore.map(chatLore), tool: { data, badges } };
  }

  async pageWrite(frame: Frame, value: unknown) {
    this.storage.take(frame.entry.module);
    const context = this.context(frame, undefined);
    const outcome = await this.convert(frame, context, value);
    if (!frame.closing.signal.aborted) await this.services.pages.pageWrite(context.chat, frame.entry.module, outcome);
  }
}
