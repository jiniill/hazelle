import { expect, it, vi } from 'vitest';
import { cacheCandidates } from '../engine/cache-prescriptions';
import { blankCard } from '../engine/import/card';
import type { Block, TextBlock } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { setDefaultModel } from './assignment';
import { breakCost, forecast, type Prior } from './cache';
import { applyCacheEdit, priceCachePrescriptions } from './cache-prescriptions';
import { startChat } from './chat-log';
import { addLore, editLore } from './lore';
import { editPrompt } from './prompts';
import type { Session } from './session';
import { testConnection, testModel, testServer } from './testing';
import { cacheSend, forecastSend, type Sending } from './turn-context';

const server = testServer();
const text = (id: string, content: string, role: TextBlock['role'] = 'user'): TextBlock => ({ id, kind: 'text', name: id, text: content, role, mark: null });
const stable = text('stable', 'Stable instructions for this conversation.', 'system');
const chatSlot: Block = { id: 'chat', kind: 'slot', name: null, slot: 'chat', range: { from: 0, to: null } };

async function setup(session: Session, blocks: Block[]) {
  const { store } = session;
  const connection = await store.create('connection', { ...testConnection, type: 'generic', protocol: 'anthropic-messages', baseUrl: 'https://example.test', starred: [{ ...testModel, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, tiers: [] } }] });
  if (!connection.ok) throw new Error(connection.error);
  await setDefaultModel(store, 'main', { connection: connection.data.id, model: testModel.id });
  const settings = store.get('settings', SETTINGS_ID)!.value;
  await store.update('profile', settings.profile!, (profile) => ({ ...profile, settings: { ...profile.settings, cache: '5m', maxOutput: 100 } }));
  const prompt = settings.prompt!;
  await editPrompt(store, prompt, { blocks });
  const character = await store.create('character', { card: blankCard('bot'), folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  await server.hold(store, chat);
  await startChat(store, chat, { title: null, character: character.data.id, models: {}, variables: [['clock', 'earlier']] }, null);
  const send = async (draft = 'hello') => {
    const sending = await forecastSend(session, chat, { kind: 'send', text: draft });
    if (!sending || 'kind' in sending) throw new Error(`not sendable: ${JSON.stringify(sending)}`);
    return sending;
  };
  return { chat, prompt, send };
}

async function compare(session: Session, chat: string, old: Sending, next: Sending) {
  const before = cacheSend(old, null)!;
  const send = cacheSend(next, null)!;
  const prior: Prior = { print: { ...before, call: 'previous' }, live: true };
  const current = forecast(prior, send)!;
  const diagnosis = await session.store.evaluation.cacheDiagnosis(chat, next.turn.scope, { forecast: current, before: { prompt: old.prompt, wire: before.wire }, after: { prompt: next.prompt, wire: send.wire } });
  if (!diagnosis) throw new Error('no diagnosis');
  return { prior, current, diagnosis };
}

it('prices a proven tag block moved back after the chat without writing, then applies and undoes only that stored order', () => server.withSession(async (session) => {
  const clock: TextBlock = { ...text('clock', 'Clock: {{getvar::clock}} / {{getvar::clock}}.'), cache: true };
  const { chat, prompt, send } = await setup(session, [stable, chatSlot, clock]);
  const old = await send();
  await editPrompt(session.store, prompt, { blocks: [stable, clock, chatSlot] });
  await session.store.update('chat', chat, (value) => ({ ...value, variables: [['clock', 'later']] }));
  const next = await send();
  const { prior, current, diagnosis } = await compare(session, chat, old, next);
  expect(diagnosis.parts.flatMap(({ causes }) => causes)).toContainEqual({ kind: 'tag', tag: '{{getvar::clock}}', before: 'earlier', after: 'later' });
  const jobs = vi.spyOn(session.store.evaluation, 'prompt');
  const aborted = new AbortController();
  aborted.abort();
  expect(await priceCachePrescriptions(session.store, chat, next, diagnosis, current, prior, null, aborted.signal)).toBeNull();
  expect(jobs).not.toHaveBeenCalled();
  const prescriptions = await priceCachePrescriptions(session.store, chat, next, diagnosis, current, prior, null, new AbortController().signal);
  expect(jobs).toHaveBeenCalledTimes(1);
  expect(prescriptions).toHaveLength(1);
  const prescription = prescriptions![0]!;
  expect(prescription).toMatchObject({ cause: 'tag', action: 'after-chat', edit: { kind: 'prompt', id: prompt, block: clock.id, field: 'blocks' }, before: { read: current.against!.read, of: current.against!.of } });
  expect(prescription.after.read).toBeGreaterThan(prescription.before.read);
  expect(prescription.after.of).toBe(prescription.before.of);
  const input = jobs.mock.calls[0]![1];
  expect(input.scope.prompt!.blocks.map(({ id }) => id)).toEqual(['stable', 'chat', 'clock']);
  expect(input.seed).toBe(next.input.seed);
  expect(input.scope.clock).toBe(next.input.scope.clock);
  expect(session.store.get('prompt', prompt)!.value.blocks.map(({ id }) => id)).toEqual(['stable', 'clock', 'chat']);
  const unmovable = { ...diagnosis, parts: diagnosis.parts.map((part) => ({ ...part, from: { kind: 'block' as const, id: 'description', name: null, slot: 'description' as const } })) };
  expect(cacheCandidates(unmovable, current, next.input.scope, prompt)).toEqual([]);
  const applied = await applyCacheEdit(session.store, prescription.edit);
  if (!applied.ok) throw new Error(applied.error);
  expect(session.store.get('prompt', prompt)!.value.blocks.map(({ id }) => id)).toEqual(['stable', 'chat', 'clock']);
  expect((await applyCacheEdit(session.store, prescription.edit)).ok).toBe(false);
  await editPrompt(session.store, prompt, { name: 'Renamed meanwhile' });
  expect((await applyCacheEdit(session.store, applied.data)).ok).toBe(true);
  expect(session.store.get('prompt', prompt)!.value).toMatchObject({ name: 'Renamed meanwhile', blocks: next.input.scope.prompt!.blocks });
}));

it('prices both lore edits once and retains only the constant edit that restores the stopped entry and increases reads', () => server.withSession(async (session) => {
  const { chat, send } = await setup(session, [stable, { id: 'lorebook', kind: 'slot', slot: 'lorebook', name: null }, chatSlot]);
  const entry = crypto.randomUUID();
  await addLore(session.store, chat, null, entry);
  await editLore(session.store, entry, { keys: ['dragon'], content: '@@role user\nA dragon lives here.' });
  const old = await send('dragon');
  const next = await send('quiet');
  const { prior, current, diagnosis } = await compare(session, chat, old, next);
  const jobs = vi.spyOn(session.store.evaluation, 'prompt');
  const prescriptions = await priceCachePrescriptions(session.store, chat, next, diagnosis, current, prior, null, new AbortController().signal);
  expect(jobs).toHaveBeenCalledTimes(2);
  expect(jobs.mock.calls.map(([, input]) => input.scope.lore.find(({ id }) => id === entry)!.value)).toMatchObject([
    { constant: true }, { constant: false, content: '@@role user\n@@depth 0\nA dragon lives here.' },
  ]);
  expect(prescriptions).toHaveLength(1);
  const prescription = prescriptions![0]!;
  expect(prescription).toMatchObject({ cause: 'lore', action: 'constant', edit: { kind: 'lore', id: entry, field: 'constant', before: false, after: true } });
  expect(prescription.after.read).toBeGreaterThan(prescription.before.read);
  expect(session.store.get('lore', entry)!.value.constant).toBe(false);
  const applied = await applyCacheEdit(session.store, prescription.edit);
  if (!applied.ok) throw new Error(applied.error);
  const actual = await send('quiet');
  const priced = forecast(prior, cacheSend(actual, null)!)!;
  expect(prescription.after).toEqual({ read: priced.against!.read, of: priced.against!.of });
  expect(prescription.cost).toEqual(breakCost(actual.turn.route.connection.value, actual.turn.route.model, priced, actual.calibration.estimate.centre));
  expect(prescription.cost?.paid.amount).toBeGreaterThan(0);
  expect((await applyCacheEdit(session.store, applied.data)).ok).toBe(true);
  expect(session.store.get('lore', entry)!.value.constant).toBe(false);
}));
