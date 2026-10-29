import { expect, it, vi } from 'vitest';
import type { Down, Up } from '../tool-api/protocol';
import { connectApi } from './api';

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: Up[] = [];
  postMessage(message: Up) { this.sent.push(structuredClone(message)); }
  start() {}
  close() {}
  receive(message: Down) { this.onmessage?.(new MessageEvent('message', { data: message })); }
}
const manifest = { api: 1 as const, name: 'test', author: 'jin', displayName: 'Test', version: '1', description: '', uses: [], page: null, menu: [], settings: [] };
const chat = { id: 'chat', character: null, persona: { name: 'Jin', description: '' }, length: 2 };
const load = (role: 'background' | 'page' = 'background'): Extract<Down, { kind: 'load' }> => ({ kind: 'load', api: 1, role, code: '', manifest, settings: {}, chat, theme: 'dark' });

it('buffers per-event changes, reads its own writes, and answers heartbeats while a host call is pending', async () => {
  const port = new FakePort();
  const close = connectApi(port, (_code, api) => {
    api.on('prompt', async (chat) => {
      chat.state.set('n', 1);
      expect(await chat.state.get('n')).toBe(1);
      chat.state.delete('gone');
      expect(await chat.state.get('gone')).toBeUndefined();
      chat.edit(0, 'edited');
      chat.add('char', 'added');
      return (await chat.model('aux', [{ role: 'user', content: 'summary' }])).ok ? 'summary' : null;
    });
  });
  port.receive(load());
  await vi.waitFor(() => expect(port.sent).toContainEqual({ kind: 'loaded', listens: ['prompt'] }));
  port.receive({ kind: 'event', id: 7, event: 'prompt', chat });
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'call')).toBe(true));
  const call = port.sent.find((message) => message.kind === 'call')!;
  expect(call).toMatchObject({ event: 7, method: 'model', args: ['aux', [{ role: 'user', content: 'summary' }]] });
  port.receive({ kind: 'ping' });
  expect(port.sent.at(-1)).toEqual({ kind: 'pong' });
  port.receive({ kind: 'answer', call: call.call, ok: true, value: { ok: true, text: 'made' } });
  await vi.waitFor(() => expect(port.sent).toContainEqual({ kind: 'done', id: 7, outcome: { value: 'summary', writes: [['n', 1], ['gone', undefined]], edits: [{ index: 0, text: 'edited' }], added: [{ role: 'char', text: 'added' }], data: [], badges: [], lore: [], variables: [] } }));
  close();
});

it('buffers chat data and badges, merges pending keys, carries the prompt answer object and refuses story writes in change', async () => {
  const port = new FakePort();
  const close = connectApi(port, (_code, api) => {
    api.on('prompt', async (chat, turn) => {
      chat.data.set('index', [1]);
      chat.data.delete('old');
      expect(await chat.data.get('index')).toEqual([1]);
      expect((await chat.data.keys()).sort()).toEqual(['index', 'kept']);
      chat.badge(2, '요약됨');
      return { memory: turn.memory ? { text: 'remembered', through: 'm2' } : undefined, tool: 'recall' };
    });
    api.on('change', (chat) => { chat.edit(0, 'never'); });
  });
  port.receive(load());
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'loaded')).toBe(true));
  port.receive({ kind: 'event', id: 1, event: 'prompt', chat, turn: { memory: true } });
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'call' && message.method === 'chat.data.keys')).toBe(true));
  const keys = port.sent.findLast((message) => message.kind === 'call')!;
  expect(keys).toMatchObject({ event: 1, args: [] });
  port.receive({ kind: 'answer', call: keys.call, ok: true, value: ['old', 'kept'] });
  await vi.waitFor(() => expect(port.sent).toContainEqual({ kind: 'done', id: 1, outcome: { value: { memory: { text: 'remembered', through: 'm2' }, tool: 'recall' }, writes: [], edits: [], added: [], data: [['index', [1]], ['old', undefined]], badges: [{ index: 2, text: '요약됨' }], lore: [], variables: [] } }));
  port.receive({ kind: 'event', id: 2, event: 'change', chat, change: { kind: 'edit', index: 0, id: 'm1', version: 'v2' } });
  await vi.waitFor(() => expect(port.sent).toContainEqual(expect.objectContaining({ kind: 'failed', id: 2 })));
  close();
});

it('hands a tool call its name and arguments, sends its text back with its writes, and refuses story writes in it', async () => {
  const port = new FakePort();
  const close = connectApi(port, (_code, api) => {
    api.on('tool', (chat, name, args) => {
      if (args.edit) chat.edit(0, 'never');
      chat.badge(1, '굴림');
      return `${name} ${String(args.sides)}`;
    });
  });
  port.receive(load());
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'loaded')).toBe(true));
  port.receive({ kind: 'event', id: 1, event: 'tool', chat, name: 'roll', args: { sides: 6 } });
  await vi.waitFor(() => expect(port.sent).toContainEqual({ kind: 'done', id: 1, outcome: expect.objectContaining({ value: 'roll 6', badges: [{ index: 1, text: '굴림' }] }) }));
  port.receive({ kind: 'event', id: 2, event: 'tool', chat, name: 'roll', args: { edit: true } });
  await vi.waitFor(() => expect(port.sent).toContainEqual(expect.objectContaining({ kind: 'failed', id: 2 })));
  close();
});

it('applies message tails, keeps concurrent event buffers separate, and surfaces a refused host call', async () => {
  const port = new FakePort();
  const close = connectApi(port, (_code, api) => {
    api.on('prompt', async (chat) => (await chat.messages(-1))[0]!.text);
    api.on('menu', async (chat) => { chat.state.set('menu', true); await chat.tokens('text'); });
  });
  port.receive(load());
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'loaded')).toBe(true));
  for (let id = 1; id <= 2; id++) {
    port.receive({ kind: 'event', id, event: 'prompt', chat });
    await vi.waitFor(() => expect(port.sent.filter((message) => message.kind === 'call' && message.method === 'chat.messages')).toHaveLength(id));
    const request = port.sent.findLast((message) => message.kind === 'call')!;
    const items = [{ index: id - 1, id: String(id), role: 'user', text: `tail ${id}`, time: 1 }];
    port.receive({ kind: 'answer', call: request.call, ok: true, value: { from: id - 1, items } });
    await vi.waitFor(() => expect(port.sent).toContainEqual(expect.objectContaining({ kind: 'done', id, outcome: expect.objectContaining({ value: `tail ${id}`, writes: [] }) })));
  }
  port.receive({ kind: 'event', id: 3, event: 'menu', chat, item: 'now' });
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'call' && message.method === 'tokens')).toBe(true));
  const request = port.sent.findLast((message) => message.kind === 'call')!;
  port.receive({ kind: 'answer', call: request.call, ok: false, value: 'tokenizer' });
  await vi.waitFor(() => expect(port.sent).toContainEqual({ kind: 'failed', id: 3, message: 'tokenizer' }));
  close();
});

it('keeps page writes readable until acknowledged and fans out storage changes and messages', async () => {
  const port = new FakePort();
  let api!: Hazelle.Api;
  const changed = vi.fn();
  const message = vi.fn();
  const close = connectApi(port, (_code, made) => { api = made; api.storage.onChange(changed); api.on('message', message); });
  port.receive(load('page'));
  await vi.waitFor(() => expect(api).toBeDefined());
  api.page!.chat!.state.set('note', null);
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'done' && message.id === 0)).toBe(true));
  expect(await api.page!.chat!.state.get('note')).toBeNull();
  api.page!.chat!.state.set('note', 'new');
  expect(await api.page!.chat!.state.get('note')).toBe('new');
  port.receive({ kind: 'answer', call: 0, ok: true, value: null });
  await vi.waitFor(() => expect(port.sent.filter((message) => message.kind === 'done')).toHaveLength(2));
  port.receive({ kind: 'storage', keys: ['note'] });
  port.receive({ kind: 'message', data: { updated: true } });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(['note']));
  expect(message).toHaveBeenCalledWith({ updated: true });
  expect(() => api.on('reply', () => {})).toThrow();
  close();
});

it('sends only once the page writes before it have landed, its lore writes among them', async () => {
  const port = new FakePort();
  let api!: Hazelle.Api;
  connectApi(port, (_code, made) => { api = made; });
  port.receive(load('page'));
  await vi.waitFor(() => expect(api).toBeDefined());
  api.page!.chat!.writeLore({ name: 'save', keys: [], text: '{}', always: false, on: true });
  const sent = api.page!.chat!.send('');
  await vi.waitFor(() => expect(port.sent.some((message) => message.kind === 'done' && message.id === 0)).toBe(true));
  expect(port.sent.find((message) => message.kind === 'done')).toMatchObject({ outcome: { lore: [{ name: 'save', text: '{}' }] } });
  expect(port.sent.some((message) => message.kind === 'call' && message.method === 'chat.send')).toBe(false);
  port.receive({ kind: 'answer', call: 0, ok: true, value: null });
  await vi.waitFor(() => expect(port.sent.find((message) => message.kind === 'call' && message.method === 'chat.send')).toMatchObject({ args: ['chat', ''] }));
  const call = port.sent.find((message) => message.kind === 'call' && message.method === 'chat.send') as Extract<Up, { kind: 'call' }>;
  port.receive({ kind: 'answer', call: call.call, ok: true, value: { ok: true } });
  expect(await sent).toEqual({ ok: true });
});
