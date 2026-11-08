import type { LuaRunner } from '../binding';
import type { Event, Host, ScriptUnit } from '../../../engine/script-api';
import type { DisplayBatch, DisplayItem, RunLane, Script, SyntaxProblem } from '../../../engine/lua/run';
import type { LuaMessage, Snapshot } from '../../../engine/lua/state';
import type { ChatBasis, ChatScope } from '../../../engine/render';
import type { ScriptOutcome } from './event';
import { changedTail, sameHistory, type Tail } from '../../history-delta';
import { PendingRequests } from '../../pending-requests';
import { Heartbeat, moduleWorker } from '../../worker';
import workerUrl from './worker?worker&url';

type EventInput = { scope: ChatBasis; history: Tail<ChatScope['messages'][number]> };

type DisplayInstall = { revision: number; scripts: Script[]; snapshot: Omit<Snapshot, 'messages' | 'scope'> & { scope: Omit<Snapshot['scope'], 'messages'> }; messages: Tail<LuaMessage>; history: Tail<Snapshot['scope']['messages'][number]>; items: DisplayItem[] };

export type Down =
  | { kind: 'run'; id: number; owner: string; triggers: ScriptUnit[]; input: EventInput; event: Event; lane: RunLane }
  | { kind: 'cancel'; id: number }
  | { kind: 'install-display'; id: number; owner: string; install: DisplayInstall }
  | { kind: 'display'; id: number; owner: string; revision: number; size: number }
  | { kind: 'forget-display'; owner: string; revision: number }
  | { kind: 'check'; id: number; code: string }
  | { kind: 'answer'; call: number; value: unknown }
  | { kind: 'ping' };
export type Up =
  | { kind: 'done'; id: number; result: Result }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'say'; id: number; args: Parameters<Host['say']> }
  | { kind: 'ask'; id: number; call: number; args: Parameters<Host['ask']> }
  | { kind: 'model'; id: number; call: number; args: Parameters<Host['model']> }
  | { kind: 'embed'; id: number; call: number; args: Parameters<Host['embed']> }
  | { kind: 'tokens'; id: number; call: number; args: Parameters<Host['tokens']> }
  | { kind: 'lore'; id: number; call: number; args: Parameters<Host['lore']> }
  | { kind: 'background'; id: number; call: number; args: Parameters<Host['background']> }
  | { kind: 'pong' };

// The engine stops a script's stretch at 5 s by itself; this catches what it cannot count, such as one pattern match
// that never ends.
const STUCK_MS = 8000;

export class LuaStuck extends Error {}

type Result = ScriptOutcome | DisplayBatch | SyntaxProblem | null;

export class LuaWorker implements LuaRunner {
  private worker: Worker | null = null;
  private readonly pending = new PendingRequests<Result, Host | null>();
  private readonly displays = new Map<string, { revision: number; snapshot: Snapshot }>();
  // One ordered event transport, not a cache per chat; the receiver applies each tail before awaiting Lua.
  private history: ChatScope['messages'] = [];
  private readonly heart = new Heartbeat(() => this.worker?.postMessage({ kind: 'ping' } satisfies Down), () => this.end(new LuaStuck('stuck')));

  run(owner: string, triggers: ScriptUnit[], scope: ChatScope, event: Event, host: Host, lane: RunLane, signal?: AbortSignal): Promise<ScriptOutcome> {
    const { messages, ...fixed } = scope;
    const input: EventInput = { scope: fixed, history: changedTail(this.history, messages, sameHistory) };
    this.history = messages;
    return this.send((id) => ({ kind: 'run', id, owner, triggers, input, event, lane }), host, signal) as Promise<ScriptOutcome>;
  }

  installDisplay(owner: string, revision: number, scripts: Script[], snapshot: Snapshot, items: DisplayItem[]): Promise<void> {
    const previous = this.displays.get(owner)?.snapshot;
    const { messages, scope, ...rest } = snapshot;
    const { messages: history, ...fixed } = scope;
    const install: DisplayInstall = {
      revision, scripts, items, snapshot: { ...rest, scope: fixed },
      messages: changedTail(previous?.messages ?? [], messages, (a, b) => a.role === b.role && a.data === b.data && a.time === b.time),
      history: changedTail(previous?.scope.messages ?? [], history, sameHistory),
    };
    this.displays.set(owner, { revision, snapshot });
    return this.send((id) => ({ kind: 'install-display', id, owner, install }), null).then(() => {});
  }

  display(owner: string, revision: number, size: number): Promise<DisplayBatch> {
    return this.send((id) => ({ kind: 'display', id, owner, revision, size }), null) as Promise<DisplayBatch>;
  }

  check(code: string): Promise<SyntaxProblem | null> {
    return this.send((id) => ({ kind: 'check', id, code }), null) as Promise<SyntaxProblem | null>;
  }

  forgetDisplay(owner: string, revision: number) {
    if (this.displays.get(owner)?.revision === revision) this.displays.delete(owner);
    this.worker?.postMessage({ kind: 'forget-display', owner, revision } satisfies Down);
  }

  close() {
    this.end(new LuaStuck('closed'));
  }

  private send(message: (id: number) => Down, host: Host | null, signal?: AbortSignal): Promise<Result> {
    const { id, promise } = this.pending.add(host);
    try {
      this.open().postMessage(message(id));
      this.heart.start(STUCK_MS);
    } catch (error) { this.end(new LuaStuck(String(error))); }
    if (!signal) return promise;
    const cancel = () => {
      if (this.pending.context(id)) this.worker?.postMessage({ kind: 'cancel', id } satisfies Down);
    };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    return promise.finally(() => signal.removeEventListener('abort', cancel));
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<Up>) => this.receive(data);
    worker.onerror = () => this.end(new LuaStuck('crashed'));
    this.worker = worker;
    return worker;
  }

  private receive(message: Up) {
    if (message.kind === 'pong') return this.heart.answered();
    if (message.kind === 'done' || message.kind === 'failed') {
      const run = this.pending.take(message.id);
      if (!run) return;
      if (this.pending.size === 0) this.heart.rest();
      if (message.kind === 'done') run.resolve(message.result);
      else run.reject(new Error(message.message));
      return;
    }
    const host = this.pending.context(message.id);
    if (!host) return;
    if (message.kind === 'say') return host.say(...message.args);
    const answering: Promise<unknown> = message.kind === 'ask' ? host.ask(...message.args) : message.kind === 'model' ? host.model(...message.args) : message.kind === 'embed' ? host.embed(...message.args) : message.kind === 'lore' ? host.lore(...message.args) : message.kind === 'background' ? host.background(...message.args) : host.tokens(...message.args);
    const worker = this.worker;
    const answer = (value: unknown) => worker?.postMessage({ kind: 'answer', call: message.call, value } satisfies Down);
    // A call the host failed at answers nothing, as a dismissed question does: unanswered, its run would never end.
    void answering.then(answer, () => answer(null));
  }

  private end(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.displays.clear();
    this.history = [];
    this.heart.rest();
    this.pending.rejectAll(() => error);
  }
}
