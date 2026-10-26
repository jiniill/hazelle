import { afterEach, expect, it, vi } from 'vitest';
import type { ChatScope } from '../../engine/render';
import type { Snapshot } from '../../engine/lua/state';
import type { Host } from '../../engine/script-api';
import { applyTail } from '../history-delta';
import { LuaWorker, type Down, type Up } from './client';
import { luaStanding } from './snapshot';

const snapshot: Snapshot = {
  messages: [{ role: 'user', data: 'first', time: 0 }, { role: 'char', data: 'last', time: 1 }], variables: [], globals: [],
  character: { name: '', description: '', firstMessage: '' }, persona: { name: '', description: '' }, note: '',
  scope: { card: null, persona: null, prompt: null, note: null, lore: [], loreFolders: {}, loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false }, variables: [], greeting: null, model: null, axModel: null, clock: { now: 0, timeZone: 'UTC' }, assets: [], inlays: [], textfiles: [], modules: [], faces: { char: null, user: null }, screen: null, pick: 'chat', messages: [
    { id: 'a', message: 'a', seed: 'a', role: 'user', text: 'first', time: 0 }, { id: 'b', message: 'b', seed: 'b', role: 'assistant', text: 'last', time: 1 },
  ] },
};

afterEach(() => vi.unstubAllGlobals());

it('installs history deltas once per revision and sends only revision/size for stretches', async () => {
  const sent: Down[] = [];
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: Up }) => void) | null = null;
    postMessage(message: Down) {
      sent.push(structuredClone(message));
      if ('id' in message) queueMicrotask(() => this.onmessage?.({ data: { kind: 'done', id: message.id, result: message.kind === 'install-display' ? null : { texts: [], listening: [], errors: [], missing: [], from: 0, remaining: 0 } } }));
    }
    terminate() {}
  });
  const runner = new LuaWorker();
  try {
    await runner.installDisplay('chat', 1, [], snapshot, []);
    await runner.display('chat', 1, 8);
    await runner.display('chat', 1, 512);
    const next = { ...snapshot, messages: [snapshot.messages[0]!, { ...snapshot.messages[1]!, data: 'new' }], scope: { ...snapshot.scope, messages: [snapshot.scope.messages[0]!, { ...snapshot.scope.messages[1]!, text: 'new' }] } };
    await runner.installDisplay('chat', 2, [], next, []);
    runner.forgetDisplay('chat', 1);
    await runner.installDisplay('chat', 3, [], next, []);
    const installed = sent.filter((message) => message.kind === 'install-display');
    expect(installed.map(({ install }) => [install.messages.from, install.messages.items.length, install.history.from, install.history.items.length])).toEqual([[0, 2, 0, 2], [1, 1, 1, 1], [2, 0, 2, 0]]);
    expect(sent.filter((message) => message.kind === 'display')).toEqual([
      { kind: 'display', id: 2, owner: 'chat', revision: 1, size: 8 },
      { kind: 'display', id: 3, owner: 'chat', revision: 1, size: 512 },
    ]);
  } finally { runner.close(); }
});

it('sends event history tails in order across edits, truncation, chat switches and a worker restart', async () => {
  const sent: Down[] = [];
  const histories: ChatScope['messages'][] = [];
  let crash: () => void;
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: Up }) => void) | null = null;
    onerror: (() => void) | null = null;
    history: ChatScope['messages'] = [];
    constructor() { crash = () => this.onerror?.(); }
    postMessage(message: Down) {
      sent.push(structuredClone(message));
      if (message.kind !== 'run') return;
      this.history = applyTail(this.history, message.input.history);
      histories.push(this.history);
      queueMicrotask(() => this.onmessage?.({ data: { kind: 'done', id: message.id, result: { value: undefined, stop: false, handled: false, writes: [], edits: [], removed: [], added: [], reload: false, lore: [], errors: [], missing: [] } } }));
    }
    terminate() {}
  });
  const runner = new LuaWorker();
  const host: Host = { say() {}, ask: async () => null, model: async () => ({ success: true, result: '' }), embed: async () => ({ ok: false, reason: 'no-model' }), tokens: async () => 0, lore: async () => [], background: async () => false };
  const scope: ChatScope = { ...snapshot.scope, cast: [], packs: [], toggles: new Map() };
  const changed = { ...scope, messages: [scope.messages[0]!, { ...scope.messages[1]!, text: 'edited', after: [['turn', '2']] as [string, string][] }] };
  const shorter = { ...changed, messages: changed.messages.slice(0, 1) };
  const other = { ...scope, messages: [{ ...scope.messages[0]!, id: 'other' }] };
  try {
    for (const next of [scope, scope, changed, shorter, other]) await runner.run(next === other ? 'other' : 'chat', [], next, { kind: 'start' }, host, 'event');
    crash!();
    await runner.run('other', [], other, { kind: 'start' }, host, 'event');
    expect(sent.filter(message => message.kind === 'run').map(({ input }) => [input.history.from, input.history.items.length])).toEqual([[0, 2], [2, 0], [1, 1], [1, 0], [0, 1], [0, 1]]);
    expect(histories).toEqual([scope.messages, scope.messages, changed.messages, shorter.messages, other.messages, other.messages]);
  } finally { runner.close(); }
});

it('keeps each pending host until completion and ignores old replies after a crash and restart', async () => {
  const made: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: { data: Up }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn<(message: Down) => void>();
    terminate = vi.fn();
    constructor() { made.push(this); }
    receive(data: Up) { this.onmessage?.({ data }); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const runner = new LuaWorker();
  const host: Host = { say: vi.fn(), ask: async () => null, model: async () => ({ success: true, result: '' }), embed: async () => ({ ok: false, reason: 'no-model' }), tokens: async () => 0, lore: async () => [], background: async () => false };
  const other = { ...host, say: vi.fn() };
  const scope: ChatScope = { ...snapshot.scope, cast: [], packs: [], toggles: new Map() };
  try {
    const first = runner.run('first', [], scope, { kind: 'start' }, host, 'event');
    const second = runner.run('second', [], scope, { kind: 'start' }, other, 'event');
    const worker = made[0]!;
    worker.receive({ kind: 'failed', id: 1, message: 'script failed' });
    await expect(first).rejects.toThrow('script failed');
    worker.receive({ kind: 'say', id: 1, args: ['normal', 'late', { kind: 'character', id: 'c' }] });
    worker.receive({ kind: 'say', id: 2, args: ['normal', 'still running', { kind: 'character', id: 'c' }] });
    expect(host.say).not.toHaveBeenCalled();
    expect(other.say).toHaveBeenCalledExactlyOnceWith('normal', 'still running', { kind: 'character', id: 'c' });
    worker.onerror!();
    await expect(second).rejects.toThrow('crashed');
    const restarted = runner.run('third', [], scope, { kind: 'start' }, host, 'event');
    worker.receive({ kind: 'done', id: 2, result: null });
    const next = made[1]!;
    expect(next.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run', id: 3 }));
    next.receive({ kind: 'say', id: 3, args: ['normal', 'new run', { kind: 'character', id: 'c' }] });
    expect(host.say).toHaveBeenCalledExactlyOnceWith('normal', 'new run', { kind: 'character', id: 'c' });
    next.receive({ kind: 'failed', id: 3, message: 'new failure' });
    await expect(restarted).rejects.toThrow('new failure');
  } finally { runner.close(); }
});

it("names a chat's missing persona 'User', as Risu does", () => {
  expect(luaStanding({ ...snapshot.scope, toggles: new Map(), packs: [], cast: [] }).persona.name).toBe('User');
});
