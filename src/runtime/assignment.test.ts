import { expect, it } from 'vitest';
import { callRef } from '../model/chat';
import type { Stored } from '../model/kinds';
import { pinnedBy, routeOf, setAccountTaskModel, setDefaultModel } from './assignment';
import { setIllustrate } from './characters';
import { SHARED_CHAT } from './features';
import { sceneWriterOf } from './illustrate';
import { mascotWriterOf } from './mascot';
import { memoryWriter } from './memory-read';
import { briefWriterOf } from './preread';
import { switchLab } from './prompts';
import { answerable, testConnection, testModel, testServer } from './testing';

const server = testServer();

it("routes a call made through a copy to that copy, and one made through the first entry to it", () => {
  const copy = { ...testModel, entry: '#low', label: 'M (low)' };
  const connection: Stored<'connection'> = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { ...testConnection, starred: [testModel, copy] } };
  const store = { get: ((kind: string, id: string) => (kind === 'connection' && id === 'c' ? connection : undefined)) as never };
  expect(routeOf(store, callRef({ connection: 'c', model: testModel.id, entry: '#low' }))).toEqual({ connection, model: copy });
  expect(routeOf(store, callRef({ connection: 'c', model: testModel.id }))).toEqual({ connection, model: testModel });
});

it('marks the prompt whose own 대화 모델 a chat talks on, and none once the chat picks its own or the prompt only its 보조', () => {
  const ref = { connection: 'c', model: 'm' };
  const choice = (models: object) => ({ kind: 'prompt', own: false, prompt: { id: 'p', value: { models } } }) as never;
  expect(pinnedBy({ models: {} }, choice({ main: ref }))).toMatchObject({ id: 'p' });
  expect(pinnedBy({ models: { main: ref } }, choice({ main: ref }))).toBeNull();
  expect(pinnedBy({ models: {} }, choice({ aux: ref }))).toBeNull();
  expect(pinnedBy({ models: {} }, { kind: 'missing', own: false })).toBeNull();
});

it('runs each task on its feature’s own model, and on 보조 모델 while it has none', () =>
  server.withSession(async (session) => {
    const { store } = session;
    await answerable(session);
    await switchLab(store, 'preread', true);
    const [connection] = store.list('connection');
    const ids = ['aux', 'scene', 'memory', 'mascot', 'preread'];
    await store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, ...ids.map((id) => ({ ...current.starred[0]!, id, name: id }))] }));
    const ref = (model: string) => ({ connection: connection!.id, model });
    const writers = () =>
      [sceneWriterOf(store, SHARED_CHAT), memoryWriter(store, SHARED_CHAT), mascotWriterOf(store, SHARED_CHAT), briefWriterOf(store, SHARED_CHAT)].map((writer) => ('kind' in writer ? writer.kind : writer.route.model.id));
    await setDefaultModel(store, 'aux', ref('aux'));
    expect(writers()).toEqual(['aux', 'aux', 'aux', 'aux']);
    await setIllustrate(store, null, { sceneModel: ref('scene') });
    for (const task of ['memory', 'mascot', 'preread'] as const) await setAccountTaskModel(store, task, ref(task));
    expect(writers()).toEqual(['scene', 'memory', 'mascot', 'preread']);
    await setAccountTaskModel(store, 'memory', null);
    expect(writers()[1]).toBe('aux');
  }));
