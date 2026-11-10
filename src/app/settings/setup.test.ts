import { expect, it } from 'vitest';
import type { Route, RolePick } from '../../runtime/models/assignment';
import type { Overview, TaskRun } from '../../runtime/tasks/overview';
import { findingsOf, mapOf } from './setup';

const connection = { id: 'c', value: { label: 'C', starred: [{ id: 'm', name: 'M' }] } } as never;
const route = { connection, model: { id: 'm', name: 'M' } } as never as Route;
const picked = (role: 'main' | 'aux'): RolePick => ({ runs: route, from: { layer: 'settings', role } });
const gone: RolePick = { runs: { kind: 'model-gone' }, from: { layer: 'settings', role: 'aux' } };
const none: RolePick = { runs: { kind: 'no-model' }, from: null };

const overview = (aux: RolePick): Overview => ({
  roles: { main: picked('main'), aux, embed: none },
  talk: { prompt: { kind: 'prompt', own: false, prompt: { id: 'p', value: { name: '기본' } } } as never, pins: [] },
  tasks: [
    { feature: 'translate', on: true, own: undefined, apart: false, runs: 'kind' in aux.runs ? aux.runs : { route } },
    { feature: 'memory', on: true, own: undefined, apart: false, runs: { route }, by: null },
  ] as TaskRun[],
});

it('says a 보조 모델 that fails once, not again for each task that follows it, and draws a missing 임베딩 모델 as a gap', () => {
  const found = findingsOf(overview(gone), ['translate', 'memory']);
  expect(found.map(({ node }) => node)).toEqual(['r:aux', 'r:embed']);
  const { edges } = mapOf(overview(picked('aux')), [connection], ['translate', 'memory'], found);
  expect(edges).toContainEqual({ from: 'r:embed', to: 'f:memory', kind: 'gap' });
  expect(edges).toContainEqual({ from: 'r:aux', to: 'f:translate', kind: 'follow' });
  expect(findingsOf(overview(picked('main')), ['translate'])).toEqual([]);
});
