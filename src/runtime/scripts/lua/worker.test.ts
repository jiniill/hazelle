import { afterEach, expect, it, vi } from 'vitest';
import { Lua } from '../../../engine/lua/run';
import type { Snapshot } from '../../../engine/lua/state';
import type { ChatScope } from '../../../engine/render';
import type { Event } from '../../../engine/script-api';
import { noOutcome } from '../binding';
import type { Down } from './client';
import { luaSnapshot, luaStanding } from './snapshot';

vi.mock('../../../engine/lua/run', () => ({ Lua: { create: vi.fn() } }));
vi.mock('../../../engine/render', async (actual) => {
  const render = await actual<typeof import('../../../engine/render')>();
  return { ...render, renderChat: vi.fn(render.renderChat) };
});
afterEach(() => vi.unstubAllGlobals());

const listen = async () => {
  let receive: (event: { data: Down }) => void;
  const sent = vi.fn();
  vi.stubGlobal('self', { postMessage: sent });
  vi.stubGlobal('addEventListener', (_type: string, listener: typeof receive) => { receive = listener; });
  await import('./worker');
  return { sent, receive: (data: Down) => receive({ data }) };
};

it('reports a failed WASM load to its job without rejecting again when that display is forgotten', async () => {
  vi.mocked(Lua.create).mockRejectedValue(new TypeError('Load failed'));
  const { sent, receive } = await listen();
  receive({ kind: 'check', id: 1, code: '' });
  await vi.waitFor(() => expect(sent).toHaveBeenCalledWith({ kind: 'failed', id: 1, message: 'TypeError: Load failed' }));
  receive({ kind: 'forget-display', owner: 'chat', revision: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent).toHaveBeenCalledTimes(1);
});

it("replays the chat once for runs of one basis and never for a run that reads none, each reading its own pending as the full replay would", async () => {
  vi.resetModules();
  const { Lua: fresh } = await import('../../../engine/lua/run');
  const { renderChat } = await import('../../../engine/render');
  const read: Snapshot[] = [];
  const run = vi.fn(async (_owner: string, _triggers: unknown, snapshot: () => Snapshot, event: Event) => {
    if (event.kind === 'start') read.push(snapshot());
    return noOutcome();
  });
  vi.mocked(fresh.create).mockResolvedValue({ run } as unknown as Lua);
  const { sent, receive } = await listen();
  const { messages, ...basis }: ChatScope = {
    card: null, cast: [], packs: [], persona: null, prompt: null, promptOut: false, note: null, lore: [], loreFolders: {}, loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false },
    variables: [['hp', '1']], status: { definitions: [], state: {} }, greeting: { index: 0 }, toggles: new Map(), model: null, axModel: null, clock: { now: 0, timeZone: 'UTC' },
    assets: [], inlays: [], textfiles: [], modules: [], faces: { char: null, user: null }, screen: null, pick: 'chat',
    messages: [
      { id: 'g', message: 'g', seed: 'g', role: 'assistant', text: 'hp {{getvar::hp}}', time: 0 },
      { id: 'a', message: 'a', seed: 'a', role: 'user', text: 'hi{{setvar::turn::1}}', time: 1 },
    ],
  };
  const pending: [string, string][] = [['hp', '3'], ['mp', '2']];
  const runOf = (id: number, scope: Omit<ChatScope, 'messages'>, at: number, basis: number, kind: 'start' | 'output' = 'start'): Down => ({ kind: 'run', id, owner: 'chat', triggers: [], event: { kind }, lane: 'event', input: { scope, history: { from: at, items: messages.slice(at) }, basis } });
  receive(runOf(1, basis, 0, 1));
  receive(runOf(2, { ...basis, pending }, 2, 1));
  receive(runOf(3, { ...basis, pending }, 2, 2));
  receive(runOf(4, { ...basis, pending }, 2, 3, 'output'));
  await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(4));
  expect(vi.mocked(renderChat)).toHaveBeenCalledTimes(2);
  const full = { ...basis, messages, pending };
  const { staged, variables } = vi.mocked(renderChat).getMockImplementation()!('prompt', full);
  expect(read).toEqual([
    luaSnapshot(full, luaStanding(full), staged, [['hp', '1'], ['turn', '1']]),
    luaSnapshot(full, luaStanding(full), staged, [...variables]),
    luaSnapshot(full, luaStanding(full), staged, [...variables]),
  ]);
});
