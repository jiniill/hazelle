import { readTool } from '../../engine/import/tool';
import { expect, it } from 'vitest';
import { importCard } from '../../engine/import/card';
import type { ImportedModule } from '../../engine/import/types';
import { convertPreset } from '../../engine/import/preset';
import { readToolFile } from '../../engine/import/risu-plugin';
import { RISU_DECLINED } from '../../tool-api/risu-methods';
import { characterOutcome, characterPreview, chatOutcome, chatPreview, DECLINED_WORDS, moduleOutcome, modulePreview, promptOutcome, promptPreview, toolOutcome, toolPreview, type Placement } from './importOutcome';

it('keeps card and module previews as detached text without asset readers or source bytes, and a saved card names only what the store refused', () => {
  const parsed = importCard('card.json', new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Mira', first_mes: 'Hi' } })));
  if (!parsed.ok || !('card' in parsed)) throw new Error('fixture');
  const bytes = new Uint8Array([1, 2, 3]);
  const imported = { ...parsed.card, assets: [{ name: 'picture', read: async () => bytes }] };
  const card = characterPreview(imported);
  const module: ImportedModule = { name: 'Bell', description: '', namespace: null, risu: null, pack: imported.card, lore: [], loreFolders: [], assets: imported.assets, unsupported: [] };
  const report = modulePreview(module, null);
  expect(card).toEqual({ kind: 'character', title: 'Mira', holds: '첫인사 1개 · 에셋 1개', verdict: null, placed: null, missed: [], unused: null });
  expect(report).toEqual({ kind: 'module', title: 'Bell', holds: '에셋 1개', verdict: null, placed: null, missed: [], unused: null });
  expect(structuredClone([card, report])).toEqual([card, report]);
  imported.card.name = 'Changed';
  imported.assets.length = 0;
  expect(card.title).toBe('Mira');
  expect(report.holds).toBe('에셋 1개');
  expect(characterOutcome('card.charx', 'Mira', { id: 'character', unsupported: [{ kind: 'unsupported-file', count: 1 }], faceless: true }).missed).toEqual(['이미지: 가져오지 못함', '지원하지 않는 형식의 파일 1개']);
});

it('says where a module will be turned on, then that it was, or was not when that failed', () => {
  const module: ImportedModule = { name: 'Bell', description: '', namespace: null, risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] };
  expect([modulePreview(module, 'character'), modulePreview(module, null)].map((each) => each.placed?.text)).toEqual(['이 캐릭터에 켜요.', undefined]);
  const lines = (at: Placement['at'], failure: string | null = null) => moduleOutcome('bell.risum', 'Bell', 'module', [], { at, failure }, { prompts: [], failure: null }, null).lines;
  expect([lines('character'), lines('prompt'), lines('always'), lines(null)].map((each) => each[0]?.text)).toEqual(['이 캐릭터에 켰어요.', '이 프롬프트에 켰어요.', '항상 켰어요.', '아직 어디에도 켜지 않았어요. 설정 › 모듈에서 켤 수 있어요.']);
  expect(lines('character', '없어진 캐릭터예요.')).toEqual([{ text: '이 캐릭터에 켜지 못했어요. 없어진 캐릭터예요.', failed: true }]);
});

it('says a module replaced its older versions, and is not "on nowhere" when it took over their places', () => {
  const outcome = (places: number) => moduleOutcome('bell.risum', 'Bell', 'module', [], { at: null, failure: null }, { prompts: [], failure: null }, { names: ['Bell 1', 'Bell 2'], places, failure: null });
  expect(outcome(2).lines).toEqual([{ text: "'Bell 1', 'Bell 2' 모듈을 바꿨어요. 원래 켜져 있던 위치에 그대로 적용했어요.", failed: false }]);
  expect(outcome(0).lines.map((line) => line.text)).toEqual(["'Bell 1', 'Bell 2' 모듈을 바꿨어요.", '아직 어디에도 켜지 않았어요. 설정 › 모듈에서 켤 수 있어요.']);
});

it('previews a tool import or a version replacement without retaining the code', () => {
  const read = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@version 1.1'));
  if (!read.ok) throw new Error('fixture');
  const { manifest } = read.tool;
  expect(toolPreview(manifest, null, 'always')).toMatchObject({ holds: '버전 1.1', placed: { text: '항상 켜요.' } });
  const previous = { manifest: { ...manifest, version: '1.0' }, file: { id: 'f', key: 'k' }, size: 10, settings: {} };
  const updated = toolPreview(manifest, previous, 'always');
  expect(updated).toMatchObject({ holds: '버전을 바꿔요 · 1.0 → 1.1', placed: null });
  expect(structuredClone(updated)).toEqual(updated);
  expect(toolOutcome('notes.js', 'notes', { id: 'm', previous: null }, { at: null, failure: null }).lines[0]?.text).toBe('아직 어디에도 켜지 않았어요. 설정 › 플러그인에서 켤 수 있어요.');
  expect(toolOutcome('notes.js', 'notes', { id: 'm', previous }, { at: 'always', failure: null }).lines).toEqual([]);
});

it('names the slot a preset placed twice, and the modules its prompt was turned on with', () => {
  const read = convertPreset({ name: '누렁이', promptTemplate: [{ type: 'authornote', role: 'system' }, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }, { type: 'authornote', role: 'system' }] });
  if (!read.ok) throw new Error(read.failure.kind);
  const preview = promptPreview(read);
  expect(preview).toMatchObject({ kind: 'prompt', title: '누렁이', holds: '블록 2개' });
  expect(preview.missed[0]).toBe('겹친 작가의 노트 블록 1개(처음 것만 가져옴)');
  expect(promptOutcome('nureong.risup', preview.title, 'prompt', ['누렁이모듈'], []).lines).toEqual([{ text: "'누렁이모듈' 모듈을 이 프롬프트에 켰어요.", failed: false }]);
});

it('names the modules a preset waits for, beside or without those turned on', () => {
  const paired = (modules: string[], waiting: string[]) => promptOutcome('so.risup', '소악마', 'prompt', modules, waiting).lines[0]?.text;
  expect(paired(['소악마'], ['소악마에셋'])).toBe("'소악마' 모듈을 이 프롬프트에 켰어요. '소악마에셋' 모듈은 가져오면 켜져요.");
  expect(paired([], ['소악마에셋'])).toBe("'소악마에셋' 모듈은 가져오면 이 프롬프트에 켜져요.");
});

it('says how much of a Risu plugin works before it is saved, wording declined names apart from those not mapped yet', () => {
  const verdict = (source: string) => {
    const read = readToolFile(new TextEncoder().encode(`//@name plug\n//@api 3.0\n${source}`));
    if (!read.ok) throw new Error('fixture');
    return toolPreview(read.tool.manifest, null, null).verdict;
  };
  expect(verdict('risuai.showContainer("fullscreen")')).toEqual({ text: 'Risu 플러그인 기능이 다 돼요.', failed: false });
  expect(verdict('risuai.addProvider(); risuai.registerBodyIntercepter(); risuai.readInlay()')).toEqual({
    text: 'Risu 플러그인 기능 중 일부는 빠져요.', failed: true,
    help: { label: '빠지는 기능', text: '앞으로도 지원하지 않아요: 모델 제공자 추가, 모델 요청 내용 바꾸기. 아직 지원하지 않아요: readInlay.' },
  });
  expect(verdict('start(risuai)')).toMatchObject({ text: 'Risu 플러그인 기능이 다 되는지 확인하지 못했어요.', failed: true });
  expect([...RISU_DECLINED].filter((name) => !DECLINED_WORDS[name])).toEqual([]);
});

it('says a file of chats goes to a character, or in 캐릭터 없이', () => {
  expect([chatPreview('a.json', 1, [], 'Mira'), chatPreview('a.json', 1, [], null), chatPreview('a.json', 1, [], undefined)].map((each) => each.placed?.text)).toEqual(['Mira에 넣어요.', '캐릭터 없이 넣어요.', undefined]);
  expect(chatOutcome('a.json', ['c'], null, []).lines[0]?.text).toBe('캐릭터 없이 넣었어요.');
});
