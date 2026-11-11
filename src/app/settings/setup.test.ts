import { expect, it } from 'vitest';
import type { Route, RolePick } from '../../runtime/models/assignment';
import type { Overview, TaskRun } from '../../runtime/tasks/overview';
import { failingOf, findingsOf, mapOf } from './setup';

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
  used: [{ connection: 'c', model: 'm' }],
});

it('says a 보조 모델 that fails once, not again for each task that follows it, and draws a missing 임베딩 모델 as a gap', () => {
  const found = findingsOf(overview(gone), ['translate', 'memory']);
  expect(found.map(({ node }) => node)).toEqual(['r:aux', 'r:embed']);
  const { edges } = mapOf(overview(picked('aux')), [connection], ['translate', 'memory'], found);
  expect(edges).toContainEqual({ from: 'r:embed', to: 'f:memory', kind: 'gap' });
  expect(edges).toContainEqual({ from: 'r:aux', to: 'f:translate', kind: 'follow' });
  expect(findingsOf(overview(picked('main')), ['translate'])).toEqual([]);
});

it('marks every feature that is on and cannot run, whatever the cause, and none that is off or runs', () => {
  const failing = overview(gone);
  expect(Object.keys(failingOf(failing, ['translate', 'memory']))).toEqual(['translate']);
  expect(failingOf({ ...failing, tasks: failing.tasks.map((task) => ({ ...task, on: false })) }, ['translate', 'memory'])).toEqual({});
  expect(Object.keys(failingOf({ ...overview(picked('aux')), roles: { main: none, aux: picked('aux'), embed: none } }, ['translate']))).toEqual(['chat']);
});

it('draws an added model the setup does not reach as off, which the map folds away', () => {
  const spare = { id: 'c', value: { label: 'C', starred: [{ id: 'm', name: 'M' }, { id: 'spare', name: 'Spare' }] } } as never;
  const { columns } = mapOf(overview(picked('aux')), [spare], ['translate'], []);
  expect(columns[1]!.nodes.map(({ title, tone }) => [title, tone])).toEqual([
    ['M', 'plain'],
    ['Spare', 'off'],
  ]);
});
