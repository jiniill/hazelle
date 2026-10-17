import { decompressSync, gzipSync } from 'fflate';
import { unpack as unpackMsgpack } from 'msgpackr';
import { expect, it } from 'vitest';
import type { Block, ConversationPrompt } from '../../model/prompt';
import { convertPreset, importPreset, writePreset } from './preset';
import { unpack } from './risum';

it("keeps a preset's toggle lines in order, one it cannot read as written and counted", () => {
  const read = convertPreset({ name: 'p', promptTemplate: [], customPromptTemplateToggle: '=모드=group\nsims=시뮬레이터\n==groupEnd\n=안내=caption\n모드 고르기' });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.toggles).toEqual([
    { kind: 'group', label: '모드' },
    { key: 'sims', label: '시뮬레이터', kind: 'check', default: '0' },
    { kind: 'groupEnd' },
    { kind: 'caption', label: '안내' },
    { kind: 'unread', text: '모드 고르기' },
  ]);
  expect(read.unsupported).toContainEqual({ kind: 'toggle-line', count: 1 });
});

it('keeps a description and a persona in every place, as a preset that moves them by a toggle does, and folds a lorebook placed twice', () => {
  const persona = (at: string) => ({ type: 'persona', innerFormat: `{{#if_pure {{? {{getglobalvar::toggle_topbotpersona}}=${at}}}}}{{slot}}{{/if}}` });
  const read = convertPreset({
    name: 'p',
    promptTemplate: [{ type: 'description' }, persona('0'), { type: 'lorebook' }, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }, { type: 'description' }, persona('2'), { type: 'lorebook' }, persona('3')],
  });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.blocks.map((block) => block.kind === 'slot' && block.slot)).toEqual(['description', 'persona', 'lorebook', 'chat', 'description', 'persona', 'persona']);
  expect(read.prompt.blocks.flatMap((block) => (block.kind === 'slot' && block.slot === 'persona' ? [block.wrapper?.match(/=(\d)/)?.[1]] : []))).toEqual(['0', '2', '3']);
  expect(read.unsupported).toEqual([{ kind: 'repeated-slot', slot: 'lorebook', count: 1 }, { kind: 'settings', count: 1 }]);
});

it('counts the prompt settings this app has no setting for, each only off its Risu default', () => {
  const kept = { type: 'chat', rangeStart: 0, rangeEnd: 'end', chatAsOriginalOnSystem: true };
  const settings = (promptSettings: object, template: object[] = []) => {
    const read = convertPreset({ name: 'p', promptTemplate: template, promptSettings });
    if (!read.ok) throw new Error(read.failure.kind);
    return read.unsupported.find(({ kind }) => kind === 'prompt-settings')?.count ?? 0;
  };
  const defaults = { assistantPrefill: '', postEndInnerFormat: '', sendChatAsSystem: false, sendName: false, utilOverride: false, customChainOfThought: false, maxThoughtTagDepth: -1 };
  expect(settings(defaults)).toBe(0);
  expect(settings({ ...defaults, customChainOfThought: true, trimStartNewChat: true, assistantPrefill: 'x' })).toBe(0);
  expect(settings({ ...defaults, postEndInnerFormat: 'end', sendName: true, utilOverride: true, maxThoughtTagDepth: 2 })).toBe(4);
  expect([settings({ sendChatAsSystem: true }, [kept]), settings({ sendChatAsSystem: true }, [kept, { ...kept, chatAsOriginalOnSystem: false }])]).toEqual([0, 1]);
});

it('places a persona, description, memory or author note item that names no role as a system slot', () => {
  const template = ['persona', 'description', 'memory', 'authornote'].map((type) => ({ type, innerFormat: '' }));
  const read = convertPreset({ name: 'p', promptTemplate: [...template, { type: 'persona', role: 'narrator' }] });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.blocks.map((block) => [block.kind === 'slot' && block.slot, 'role' in block && block.role])).toEqual([
    ['persona', 'system'],
    ['description', 'system'],
    ['memory', 'system'],
    ['authorNote', 'system'],
  ]);
  expect(read.unsupported).toContainEqual({ kind: 'unread-item', count: 1 });
});

it("reads a slot's role from role2, as current Risu writes it, and from role in older files", () => {
  const read = convertPreset({ name: 'p', promptTemplate: [{ type: 'description', role2: 'user' }, { type: 'persona', role: 'bot' }] });
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.blocks.map((block) => 'role' in block && block.role)).toEqual(['user', 'assistant']);
});

it('writes a .risup that Risu opens (msgpackr, AES-GCM) into the same prompt, keeping its model fields null', async () => {
  const blocks: Block[] = [
    { id: 'a', name: '메인', kind: 'text', role: 'system', text: '{{char}}', mark: 'main' },
    { id: 'b', name: null, kind: 'slot', slot: 'description', role: 'user', wrapper: '<desc>{{slot}}</desc>', cache: true },
    { id: 'c', name: null, kind: 'slot', slot: 'persona', role: 'system', wrapper: null },
    { id: 'd', name: null, kind: 'slot', slot: 'lorebook' },
    { id: 'e', name: null, kind: 'slot', slot: 'tool', role: 'system', wrapper: null },
    { id: 'f', name: '과거', kind: 'slot', slot: 'chat', range: { from: 0, to: -1 } },
    { id: 'g', name: null, kind: 'slot', slot: 'authorNote', role: 'assistant', wrapper: null },
    { id: 'h', name: null, kind: 'slot', slot: 'chat', range: { from: -1, to: null } },
    { id: 'i', name: null, kind: 'text', role: 'assistant', text: '노트', mark: 'globalNote' },
  ];
  const prompt: ConversationPrompt = {
    name: '프롬프트', blocks, authorNote: '기본 노트', models: {}, companions: ['risu-id'],
    toggles: [{ kind: 'group', label: '모드' }, { key: 'sims', label: '시뮬', kind: 'check', default: '0' }, { kind: 'groupEnd' }],
  };
  const written = await writePreset(prompt, ['ns', 'risu-id']);
  expect(written.tools).toBe(1);

  const outer = unpackMsgpack(decompressSync(unpack(written.bytes))) as { presetVersion: number; type: string; preset: Uint8Array };
  expect([outer.presetVersion, outer.type]).toEqual([2, 'preset']);
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('risupreset')), 'AES-GCM', false, ['decrypt']);
  const preset = unpackMsgpack(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(outer.preset)))) as Record<string, unknown>;
  expect(preset).toMatchObject({ aiModel: null, subModel: null, apiType: null, temperature: null, maxContext: null, maxResponse: null });
  expect(preset).not.toHaveProperty('repetition_penalty');

  const read = convertPreset(preset);
  if (!read.ok) throw new Error(read.failure.kind);
  expect(read.prompt.blocks).toEqual(blocks.filter((block) => block.id !== 'e').map((block) => ({ ...block, id: expect.any(String) })));
  expect(read.prompt.toggles).toEqual(prompt.toggles);
  expect(read.prompt.authorNote).toBe('기본 노트');
  expect(read.prompt.companions).toEqual(['risu-id', 'ns']);
});

it('refuses a preset that unpacks past its limit, saying so', async () => {
  const file = gzipSync(new Uint8Array(80 * 1024 * 1024));
  expect(await importPreset('Mira.risupreset', file)).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'expands-too-far' } });
});
