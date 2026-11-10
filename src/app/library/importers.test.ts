import { expect, it } from 'vitest';
import { importCard } from '../../engine/import/card';
import { convertPreset } from '../../engine/import/preset';
import { readTool } from '../../engine/import/tool';
import type { ObjectStore } from '../../runtime/store';
import { readingOf, type Parsed } from './importers';

it('reads each parsed file as its own kind, and a card as a character', async () => {
  const card = await importCard('card.json', new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Mira', first_mes: 'Hi' } })));
  const tool = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@version 1.1'));
  const preset = convertPreset({ name: '누렁이', promptTemplate: [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }] });
  if (!card.ok || !('card' in card) || !tool.ok || !preset.ok) throw new Error('fixture');
  const store = { get: () => undefined, list: () => [] } as unknown as ObjectStore;
  const parsed: Parsed[] = [
    { ok: true, risuChats: [], missed: [] },
    { ok: true, module: { name: 'Bell', description: '', namespace: null, risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] } },
    tool,
    { ok: true, preset },
    { ok: true, persona: { name: 'Jin', alias: '', description: '', picture: async () => ({ bytes: new Uint8Array(), type: 'image/png' }) } },
    card,
  ];
  const kinds = parsed.map((each) => {
    const read = readingOf(each).preview({ store, file: 'file', target: undefined, place: null });
    return typeof read === 'string' ? read : read.preview.kind;
  });
  expect(kinds).toEqual(['chat', 'module', 'plugin', 'prompt', 'persona', 'character']);
});
