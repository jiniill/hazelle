import { zipSync } from 'fflate';
import { expect, it } from 'vitest';
import type { StatusDefinition } from '../../model/status';
import { blankCard, importCard, writeCharx } from './card';
import { moduleSource, readModule } from './hazelle';
import { filed, readStatus, unfiled } from './status';
import type { Bot, TypedModule } from './types';

const filedForm = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const definition = (id: string): StatusDefinition => ({
  id,
  name: '휴대폰',
  writer: 'with',
  fields: [{ id: 'battery', name: '배터리', kind: 'gauge', min: 0, max: 100, start: 80, unit: '%', tone: 'fresh', main: true }, { id: 'todo', name: '할 일', kind: 'list', checked: true, start: [{ text: '답하기', done: true }] }],
  groups: [{ id: 'people', name: '연락처', open: true, fields: [{ id: 'tie', name: '관계', kind: 'stage', labels: ['모름', '친구'], start: '모름' }], members: [{ id: 'a', name: '도윤' }] }],
  logs: [{ id: 'messages', name: '메시지', fields: [{ id: 'with', name: '상대', kind: 'text' }, { id: 'way', name: '방향', kind: 'stage', labels: ['받음', '보냄'] }, { id: 'text', name: '내용', kind: 'text' }] }],
  views: [
    { id: 'messenger', name: '메신저', frame: 'card', mood: 'paper', app: 'messages', blocks: [{ kind: 'chat', log: 'messages', by: 'with', mine: { field: 'way', is: '보냄' }, reply: '{{name}}에게: ' }] },
    { id: 'main', name: '상태', frame: 'hud', mood: 'neon', blocks: [{ kind: 'head', fields: ['battery'] }, { kind: 'section', name: '사람', blocks: [{ kind: 'records', group: 'people', look: 'rows' }, { kind: 'log', log: 'messages', all: true, look: 'feed' }] }] },
  ],
});
const following = (definition: StatusDefinition, folder: string): StatusDefinition => ({ ...definition, groups: definition.groups.map((group) => ({ ...group, follows: { folder } })) });
const followed = ({ status }: { status?: StatusDefinition }) => status?.groups.map(({ follows }) => follows?.folder);

it('reads back a definition as it was written into a file', () => {
  expect(readStatus(filedForm(definition('s')))).toEqual(definition('s'));
});

it('leaves out what has no id or is of a kind it does not know, and reads no definition where none can be kept', () => {
  const read = readStatus({
    id: 's',
    name: '상태',
    writer: 'someday',
    fields: [{ id: 'hp', name: '체력', kind: 'gauge', min: 0, max: 100, start: '많음', tone: 'neon' }, { name: '이름 없음', kind: 'text' }, { id: 'aura', kind: 'hologram' }, { id: 'mp', kind: 'gauge', min: 0 }, 7],
    groups: [{ id: 'people', name: '사람', fields: 'none', members: [{ id: 'a', name: '도윤' }, { name: '하린' }], follows: { folder: 3 } }, { name: '묶음' }],
    logs: [null, { id: 'notes', name: '메모', fields: [{ id: 'text', name: '내용', kind: 'text' }] }],
    views: [{ id: 'v', name: '보기', frame: 'window', mood: 'plain', app: 'radio', blocks: [{ kind: 'field', field: 'hp', look: 'laser' }, { kind: 'hologram' }, { kind: 'tabs', tabs: [{ name: '탭' }, { id: 't', name: '탭', blocks: [{ kind: 'log', log: 'notes', all: 'yes' }] }] }] }, { name: '보기' }],
  });
  expect(read).toEqual({
    id: 's',
    name: '상태',
    writer: 'after',
    fields: [{ id: 'hp', name: '체력', kind: 'gauge', min: 0, max: 100 }],
    groups: [{ id: 'people', name: '사람', fields: [], members: [{ id: 'a', name: '도윤' }] }],
    logs: [{ id: 'notes', name: '메모', fields: [{ id: 'text', name: '내용', kind: 'text' }] }],
    views: [{ id: 'v', name: '보기', frame: 'window', mood: 'plain', app: 'radio', blocks: [{ kind: 'field', field: 'hp' }, { kind: 'tabs', tabs: [{ id: 't', name: '탭', blocks: [{ kind: 'log', log: 'notes' }] }] }] }],
  });
  for (const none of [undefined, null, 'status', [], {}, { name: '상태' }]) expect(readStatus(none)).toBeUndefined();
});

it('names a followed folder by its place in a file and by its new id out of one, and follows none that is not the pack’s', () => {
  const pack = { status: following(definition('mine'), 'b') };
  expect(followed(filed(pack, ['a', 'b']))).toEqual(['1']);
  expect(followed(unfiled(filed(pack, ['a', 'b']), ['x', 'y']))).toEqual(['y']);
  expect(followed(filed(pack, ['a']))).toEqual([undefined]);
  expect(followed(unfiled({ status: following(definition('mine'), '2') }, ['x', 'y']))).toEqual([undefined]);
  expect(followed(unfiled(pack, ['x', 'y']))).toEqual([undefined]);
  const plain = { status: definition('mine') };
  expect(filed(plain, ['a'])).toBe(plain);
  expect(filed({}, ['a'])).toEqual({});
});

const module = (status: StatusDefinition): TypedModule => ({
  risu: 'm', name: '전화', description: '', namespace: null, likeness: null, lore: [], loreFolders: ['사람'], assets: [], pack: { regex: [], triggers: [], toggles: [], status },
});

it('carries a character’s definition and each bundled module’s in a charx, and reads them back', async () => {
  const mine = following(definition('mine'), '0');
  const bundled = definition('theirs');
  const bot: Bot = { card: { ...blankCard('루나'), status: mine }, lore: [], loreFolders: ['사람'], avatar: null, assets: [], own: { character: {}, likeness: null }, bundled: [module(bundled)] };
  const { files } = writeCharx(bot);
  const zip = zipSync(Object.fromEntries(files.map(({ path, bytes }) => [path, bytes])));
  const read = await importCard('루나.charx', new Uint8Array(zip));
  if (!read.ok || !('card' in read)) throw new Error('not read');
  expect(read.card.report.unsupported).toEqual([]);
  expect(read.card.card.status).toEqual(mine);
  expect(read.card.bundled.map(({ pack }) => pack.status)).toEqual([bundled]);
});

it('carries a module’s definition in its own file, and a file Risu wrote over reads without one', () => {
  const status = following(definition('mine'), '0');
  const source = moduleSource(module(status));
  expect(readModule(filedForm(source) as typeof source, new Map()).pack.status).toEqual(status);
  const tally = new Map();
  expect(readModule({ ...source, name: '전화', regex: [{ comment: '새 규칙', in: 'a', out: 'b', type: 'editdisplay' }] }, tally).pack.status).toBeUndefined();
  expect(tally.get('hazelle')).toBe(1);
});
