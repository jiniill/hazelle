import { ChangeSignal } from '../change-signal';
import type { Connection, HttpRequest } from '../connectors/types';
import type { Assembled } from '../engine/pipeline';
import type { CacheDiagnosis, CacheForecast, CacheText } from '../model/cache';
import type { Receipt } from '../model/chat';
import type { AgentStage } from '../model/prompt';
import type { Stream } from '../model/stream';
import type { ObjectStore } from './store';
import type { PageClass } from './streams';

// As the stream marker (newCall) and pageCall name a call; an embedding is made by neither.
export type CallPurpose = Stream['for']['kind'] | PageClass | 'embedding';

// Who a call is for. call: its connection and model with their names, as its receipt keeps them.
export type Logged = { chat: string | null; purpose: CallPurpose; call: Stream['call'] };

export type SentRequest = Pick<HttpRequest, 'url' | 'body'>;

// An agent's call (runtime/agents): whose it was, and the parts it sent.
export type LoggedAgent = { name: string; stage: AgentStage; sent: Pick<Assembled, 'messages' | 'parts'> };

// picked calls lack request/response after reload; pre-build refusals also lack request.
// diagnosis undefined means queued/running, null means unavailable or unneeded.
export type LogEntry = Omit<Logged, 'call'> & { at: number; picked: boolean; receipt: Receipt; request: SentRequest | null; response: string | null; prompt?: Assembled; agent?: LoggedAgent; wire?: CacheText; diagnosis?: CacheDiagnosis | null };

export type ChatLog = { entries: readonly LogEntry[]; omitted: number };

// Per chat; characters count request bodies, responses and attached prompt/diagnosis text. The newest entry always stays, so the
// reply just made keeps its 요청 원문 however large it is.
export const REQUEST_LOG_LIMITS = { entries: 100, characters: 8_000_000 } as const;
const EMPTY: ChatLog = { entries: [], omitted: 0 };

const SECRET_PARAM = /^(key|api[_-]?key|access[_-]?token|token|authorization)$/i;

// Redact before credentials are applied; authentication headers never enter the log.
// Also hide secrets in imported direct URLs and anywhere the account secret was pasted.
export function redacted(request: SentRequest, connection: Connection): SentRequest {
  const url = new URL(request.url);
  let changed = false;
  if (url.username || url.password) {
    url.username = 'REDACTED';
    url.password = '';
    changed = true;
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_PARAM.test(key)) {
      url.searchParams.set(key, 'REDACTED');
      changed = true;
    }
  }
  const secrets = [...new Set(connection.accounts.flatMap(({ secret }) => (secret ? [secret, encodeURIComponent(secret)] : [])))].sort((a, b) => b.length - a.length);
  const pattern = secrets.length ? new RegExp(secrets.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  const hide = (text: string) => (pattern ? text.replace(pattern, 'REDACTED') : text);
  return { url: hide(changed ? url.href : request.url), body: request.body === null ? null : hide(request.body) };
}

const charactersOf = (value: unknown): number => typeof value === 'string' ? value.length : value && typeof value === 'object' ? Object.values(value).reduce<number>((sum, each) => sum + charactersOf(each), 0) : 0;
const size = ({ request, response, prompt, agent, wire, diagnosis }: LogEntry) => (request?.body?.length ?? 0) + (response?.length ?? 0) + charactersOf({ prompt, agent, wire, diagnosis });

// Every model call this page makes, in page memory only (ruling: nothing here is stored or survives a reload). A
// chat's entries go when its scope is released, as what a reply sent always did; a likeness's (chat null) on close.
export class RequestLog {
  private readonly chats = new Map<string | null, { log: ChatLog; characters: number }>();
  private readonly changes = new ChangeSignal();
  private readonly leave: () => void;

  constructor(store: Pick<ObjectStore, 'subscribe' | 'scopeState'>) {
    this.leave = store.subscribe((changes) => {
      const released = changes.filter((change) => change.kind === 'scope' && this.chats.has(change.id) && store.scopeState(change.id) === 'unloaded');
      if (!released.length) return;
      for (const { id } of released) this.chats.delete(id);
      this.changes.notify();
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly of = (chat: string): ChatLog => this.chats.get(chat)?.log ?? EMPTY;

  // By the call's id, which its receipt keeps through an edit, a branch and a continuation (model/chat Receipt). null:
  // its chat was released, the bound let it go, or this page did not make the call.
  entry(chat: string, call: string): LogEntry | null {
    return this.of(chat).entries.find((entry) => entry.receipt.id === call) ?? null;
  }

  record(entry: LogEntry) {
    entry = { ...entry, diagnosis: entry.diagnosis ?? null };
    const held = this.chats.get(entry.chat) ?? { log: EMPTY, characters: 0 };
    const entries = [...held.log.entries, entry];
    let { omitted } = held.log;
    let characters = held.characters + size(entry);
    while (entries.length > 1 && (entries.length > REQUEST_LOG_LIMITS.entries || characters > REQUEST_LOG_LIMITS.characters)) {
      characters -= size(entries.shift()!);
      omitted++;
    }
    this.chats.set(entry.chat, { log: { entries, omitted }, characters });
    this.changes.notify();
  }

  // forecast: what the send expected of the cache, as its receipt keeps it.
  attach(chat: string, call: string, attachment: { prompt?: Assembled; forecast?: CacheForecast; agent?: LoggedAgent; wire?: CacheText; diagnosis?: CacheDiagnosis | null }) {
    const { prompt, forecast, agent, wire, diagnosis } = attachment;
    const held = this.chats.get(chat);
    const at = held?.log.entries.findIndex((entry) => entry.receipt.id === call) ?? -1;
    if (!held || at === -1) return;
    const entry = held.log.entries[at]!;
    const next = { ...entry, ...(prompt && { prompt }), ...(agent && { agent }), ...(wire && { wire }), ...('diagnosis' in attachment && { diagnosis }), ...(forecast && { receipt: { ...entry.receipt, forecast } }) };
    const entries = held.log.entries.with(at, next);
    held.characters += size(next) - size(entry);
    let { omitted } = held.log;
    while (entries.length > 1 && held.characters > REQUEST_LOG_LIMITS.characters) {
      held.characters -= size(entries.shift()!);
      omitted++;
    }
    held.log = { entries, omitted };
    this.changes.notify();
  }

  close() {
    this.leave();
    this.chats.clear();
    this.changes.notify();
    this.changes.clear();
  }
}
