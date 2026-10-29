import { expect, it } from 'vitest';
import type { ToolChatData } from '../../model/tool';
import type { ToolManifest } from '../../tool-api/manifest';
import { badgesByVersion, pressRuns, toolActions, toolComposer, toolMenu } from './toolMenu';

const manifest = (displayName: string, page: ToolManifest['page'], menu: ToolManifest['menu']): ToolManifest => ({ api: 1, name: displayName, author: 'author', displayName, version: '1', description: '', uses: [], page, menu, settings: [] });

it('lists declared pages and actions in pack order, each under its own module identity', () => {
  const tools = [
    { module: 'notes', manifest: manifest('메모장', { label: '메모장 열기' }, []) },
    { module: 'silent', manifest: manifest('자동 도구', null, []) },
    { module: 'memory', manifest: manifest('기억', { label: '기억 열기' }, [{ id: 'now', label: '지금 정리하기' }, { id: 'clear', label: '내용 비우기' }]) },
  ];
  expect(toolMenu(tools, (module) => tools.find((tool) => tool.module === module)!.manifest.menu)).toEqual([
    { kind: 'page', module: 'notes', name: '메모장', label: '메모장 열기' },
    { kind: 'page', module: 'memory', name: '기억', label: '기억 열기' },
    { kind: 'menu', module: 'memory', name: '기억', label: '지금 정리하기', item: 'now' },
    { kind: 'menu', module: 'memory', name: '기억', label: '내용 비우기', item: 'clear' },
  ]);
  expect(toolMenu([], () => [])).toEqual([]);
});

it('groups message actions by tool and lists composer items with their own fields only', () => {
  const memory: ToolManifest = { ...manifest('기억', { label: '열기' }, []), actions: [{ id: 'redo', label: '다시 정리' }], composer: { label: '기억' }, settings: [{ key: 'auto', type: 'switch', label: '자동', composer: true }, { key: 'size', type: 'number', label: '단위' }] };
  const tools = [{ module: 'plain', manifest: manifest('메모', null, []) }, { module: 'memory', manifest: memory }];
  expect(toolActions(tools, (module) => tools.find((tool) => tool.module === module)!.manifest.actions ?? [])).toEqual([{ module: 'memory', name: '기억', items: [{ id: 'redo', label: '다시 정리' }] }]);
  expect(toolComposer(tools)).toEqual([{ module: 'memory', name: '기억', label: '기억', inputs: [], fields: [{ key: 'auto', type: 'switch', label: '자동', composer: true }], page: true }]);
});

it('runs the one input item on the button\'s press only when the button holds nothing else', () => {
  const tidy = { id: 'tidy', label: '다듬기' };
  const [alone] = toolComposer([{ module: 'tidy', manifest: { ...manifest('다듬기', null, []), composer: { label: '다듬기' }, inputs: [tidy] } }]);
  expect(pressRuns(alone!)).toEqual(tidy);
  expect(pressRuns({ ...alone!, page: true })).toBeNull();
  expect(pressRuns({ ...alone!, inputs: [tidy, { id: 'more', label: '더' }] })).toBeNull();
});

it('shows a badge only on the version it was put on, by tool in pack order, cut to ten characters', () => {
  const tools = [{ module: 'a', manifest: manifest('A', null, []) }, { module: 'b', manifest: manifest('B', null, []) }];
  const rows: { value: ToolChatData }[] = [
    { value: { module: 'b', key: null, value: { m1: { version: 'v1', text: '요약됨' } } } },
    { value: { module: 'a', key: null, value: { m1: { version: 'v1', text: '열한글자짜리배지입니다' }, m2: { version: 'v3', text: '새' } } } },
    { value: { module: 'a', key: 'index', value: { m1: { version: 'v1', text: 'data, not a badge' } } } },
    { value: { module: 'gone', key: null, value: { m1: { version: 'v1', text: '꺼진 도구' } } } },
  ];
  const badges = badgesByVersion(rows, tools);
  expect(badges.get('v1')).toEqual(['열한글자짜리배지입니', '요약됨']);
  expect(badges.get('v3')).toEqual(['새']);
  expect(badges.get('v2')).toBeUndefined();
});
