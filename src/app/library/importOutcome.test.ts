import { readTool } from '../../engine/import/tool';
import { expect, it } from 'vitest';
import { importCard } from '../../engine/import/card';
import type { ImportedModule } from '../../engine/import/types';
import { convertPreset } from '../../engine/import/preset';
import { characterOutcome, moduleOutcome, promptOutcome, toolOutcome, type Placement } from './importOutcome';

it('keeps completed card and module reports as detached text without asset readers or source bytes', () => {
  const parsed = importCard('card.json', new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Mira', first_mes: 'Hi' } })));
  if (!parsed.ok || !('card' in parsed)) throw new Error('fixture');
  const bytes = new Uint8Array([1, 2, 3]);
  const imported = { ...parsed.card, assets: [{ name: 'picture', read: async () => bytes }] };
  const card = characterOutcome('card.charx', imported, { id: 'character', unsupported: [{ kind: 'unsupported-file', count: 1 }], faceless: true });
  const module: ImportedModule = { name: 'Bell', description: '', namespace: null, risu: null, pack: imported.card, lore: [], loreFolders: [], assets: imported.assets, unsupported: [] };
  const report = moduleOutcome('bell.risum', module, 'module', [], { at: null, failure: null }, { prompts: [], failure: null }, null);
  expect(card).toEqual({ kind: 'character', file: 'card.charx', id: 'character', title: 'Mira', holds: '첫인사 1개', replaced: null, placed: null, paired: null, missed: ['이미지: 가져오지 못함', '지원하지 않는 형식의 파일 1개'], unused: null });
  expect(report).toEqual({ kind: 'module', file: 'bell.risum', id: 'module', title: '모듈 · Bell', holds: '에셋 1개', replaced: null, placed: { text: '아직 어디에도 켜지 않았어요. 설정 › 모듈에서 켤 수 있어요.', failed: false }, paired: null, missed: [], unused: null });
  expect(structuredClone([card, report])).toEqual([card, report]);
  imported.card.name = 'Changed';
  imported.assets.length = 0;
  expect(card.title).toBe('Mira');
  expect(report.holds).toBe('에셋 1개');
});

it('says where a module was turned on, and that it was not when that failed', () => {
  const module: ImportedModule = { name: 'Bell', description: '', namespace: null, risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] };
  const placed = (at: Placement['at'], failure: string | null = null) => moduleOutcome('bell.risum', module, 'module', [], { at, failure }, { prompts: [], failure: null }, null).placed;
  expect([placed('character'), placed('prompt'), placed('always')].map((each) => each?.text)).toEqual(['이 캐릭터에 켰어요.', '이 프롬프트에 켰어요.', '항상 켰어요.']);
  expect(placed('character', '없어진 캐릭터예요.')).toEqual({ text: '이 캐릭터에 켜지 못했어요. 없어진 캐릭터예요.', failed: true });
});

it('says a module replaced its older versions, and is not "on nowhere" when it took over their places', () => {
  const module: ImportedModule = { name: 'Bell', description: '', namespace: 'bell', risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] };
  const outcome = (places: number) => moduleOutcome('bell.risum', module, 'module', [], { at: null, failure: null }, { prompts: [], failure: null }, { names: ['Bell 1', 'Bell 2'], places, failure: null });
  expect(outcome(2)).toMatchObject({ replaced: { text: "'Bell 1', 'Bell 2' 모듈을 바꿨어요. 켜져 있던 곳에 그대로 켰어요.", failed: false }, placed: null });
  expect(outcome(0)).toMatchObject({ replaced: { text: "'Bell 1', 'Bell 2' 모듈을 바꿨어요.", failed: false }, placed: { text: '아직 어디에도 켜지 않았어요. 설정 › 모듈에서 켤 수 있어요.' } });
});


it('reports a tool import or a version replacement without retaining the code', () => {
  const read = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@version 1.1'));
  if (!read.ok) throw new Error('fixture');
  const { manifest } = read.tool;
  const placement = { at: 'always' as const, failure: null };
  const fresh = toolOutcome('notes.js', manifest, { id: 'm', previous: null }, placement);
  expect(fresh).toMatchObject({ kind: 'module', holds: '도구 · 1.1', placed: { text: '항상 켰어요.' } });
  const previous = { manifest: { ...manifest, version: '1.0' }, file: { id: 'f', key: 'k' }, size: 10, settings: {} };
  const updated = toolOutcome('notes.js', manifest, { id: 'm', previous }, placement);
  expect(updated.holds).toBe('버전을 바꿨어요 · 1.0 → 1.1');
  expect(updated.placed).toBeNull();
  expect(structuredClone(updated)).toEqual(updated);
  expect(updated).not.toHaveProperty('bytes');
});

it('names the slot a preset placed twice, and the modules its prompt was turned on with', () => {
  const read = convertPreset({ name: '누렁이', promptTemplate: [{ type: 'persona', role: 'system' }, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }, { type: 'persona', role: 'system' }] });
  if (!read.ok) throw new Error(read.failure.kind);
  const outcome = promptOutcome('nureong.risup', read, 'prompt', ['누렁이모듈'], []);
  expect(outcome).toMatchObject({ kind: 'prompt', title: '프롬프트 · 누렁이', holds: '블록 2개', paired: { text: "'누렁이모듈' 모듈을 이 프롬프트에 켰어요.", failed: false } });
  expect(outcome.missed[0]).toBe('겹친 페르소나 블록 1개(처음 것만 가져옴)');
});

it('names the modules a preset waits for, beside or without those turned on', () => {
  const read = convertPreset({ name: '소악마', promptTemplate: [] });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(promptOutcome('so.risup', read, 'prompt', ['소악마'], ['소악마에셋']).paired?.text).toBe("'소악마' 모듈을 이 프롬프트에 켰어요. '소악마에셋' 모듈은 가져오면 켜져요.");
  expect(promptOutcome('so.risup', read, 'prompt', [], ['소악마에셋']).paired?.text).toBe("'소악마에셋' 모듈은 가져오면 이 프롬프트에 켜져요.");
});

