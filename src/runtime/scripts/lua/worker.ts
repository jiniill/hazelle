import wasm from 'wasmoon/dist/glue.wasm?url';
import { Lua, type DisplayBatch, type SyntaxProblem } from '../../../engine/lua/run';
import type { Snapshot } from '../../../engine/lua/state';
import type { Host } from '../../../engine/script-api';
import type { ChatScope } from '../../../engine/render';
import { replayChat, runEvent, type Replay, type ScriptOutcome } from './event';
import { applyTail } from '../../evaluation/history-delta';
import type { Down, Up } from './client';

const scope = self as unknown as { postMessage(message: Up): void };
let lua: Promise<Lua> | null = null;
const displays = new Map<string, { revision: number; snapshot: Snapshot }>();
let history: ChatScope['messages'] = [];
// The last run's replay and the basis it was made on (LuaWorker.run), which a run on that basis takes again. Made as
// the run starts, in the order the runs came.
let replayed: { basis: number; replay: Replay } | null = null;
let calls = 0;
const runs = new Map<number, AbortController>();
const waiting = new Map<number, { id: number; resolve: (value: never) => void; reject: (error: unknown) => void }>();

const host = (id: number): Host => {
  const asked = <T>(send: (call: number) => Up) =>
    new Promise<T>((resolve, reject) => {
      const call = ++calls;
      waiting.set(call, { id, resolve, reject });
      scope.postMessage(send(call));
    });
  return {
    say: (...args) => scope.postMessage({ kind: 'say', id, args }),
    ask: (...args) => asked((call) => ({ kind: 'ask', id, call, args })),
    model: (...args) => asked((call) => ({ kind: 'model', id, call, args })),
    embed: (...args) => asked((call) => ({ kind: 'embed', id, call, args })),
    tokens: (...args) => asked((call) => ({ kind: 'tokens', id, call, args })),
    lore: (...args) => asked((call) => ({ kind: 'lore', id, call, args })),
    background: (...args) => asked((call) => ({ kind: 'background', id, call, args })),
  };
};

addEventListener('message', ({ data }: MessageEvent<Down>) => {
  if (data.kind === 'ping') return scope.postMessage({ kind: 'pong' });
  if (data.kind === 'cancel') {
    const run = runs.get(data.id);
    if (!run) return;
    run.abort(new Error('Lua run cancelled'));
    for (const [call, pending] of waiting) {
      if (pending.id !== data.id) continue;
      waiting.delete(call);
      pending.reject(run.signal.reason);
    }
    return;
  }
  if (data.kind === 'answer') {
    waiting.get(data.call)?.resolve(data.value as never);
    waiting.delete(data.call);
    return;
  }
  if (data.kind === 'forget-display') {
    if (displays.get(data.owner)?.revision === data.revision) displays.delete(data.owner);
    void lua?.then((machine) => machine.forgetDisplay(data.owner, data.revision), () => {
      // The job that loaded Lua reports its failure; a VM that never loaded holds no display to forget.
    });
    return;
  }
  const eventScope = data.kind === 'run' ? { ...data.input.scope, messages: history = applyTail(history, data.input.history) } : null;
  // A script in the middle of its work answers for the loop it holds: a ping waits behind it.
  lua ??= Lua.create({ wasm, alive: () => scope.postMessage({ kind: 'pong' }) });
  const { id } = data;
  const controller = data.kind === 'run' ? new AbortController() : null;
  if (controller) runs.set(id, controller);
  lua
    .then<ScriptOutcome | DisplayBatch | SyntaxProblem | null>(async (machine) => {
      if (data.kind === 'check') return machine.check(data.code);
      if (data.kind === 'run') {
        const { basis } = data.input;
        const replay = replayed?.basis === basis ? replayed.replay : (replayed = { basis, replay: replayChat(eventScope!) }).replay;
        return runEvent(machine, data.owner, data.triggers, eventScope!, data.event, host(id), data.lane, controller!.signal, replay);
      }
      if (data.kind === 'display') return machine.display(data.owner, data.revision, data.size);
      const previous = displays.get(data.owner)?.snapshot;
      const { install } = data;
      const snapshot: Snapshot = { ...install.snapshot, messages: applyTail(previous?.messages ?? [], install.messages), scope: { ...install.snapshot.scope, messages: applyTail(previous?.scope.messages ?? [], install.history) } };
      displays.set(data.owner, { revision: install.revision, snapshot });
      await machine.installDisplay(data.owner, install.revision, install.scripts, snapshot, install.items);
      return null;
    })
    .finally(() => runs.delete(id))
    .then(
      (result) => scope.postMessage({ kind: 'done', id, result }),
      (error: unknown) => scope.postMessage({ kind: 'failed', id, message: String(error) }),
    );
});
