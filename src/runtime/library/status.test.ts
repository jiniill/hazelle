import { expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { blankStatus } from '../../model/statusTypes';
import { translatorPrompt } from '../../engine/translate';
import { testServer } from '../testing';
import { setStatus } from './status';

const server = testServer();

it('writes a definition onto a character, a module and a conversation prompt, removes it whole, and gives no other sort of prompt one', async () => {
  const { store } = await server.account();
  const made = async <T>(created: Promise<{ ok: true; data: { id: string } } | { ok: false; error: T }>) => {
    const result = await created;
    if (!result.ok) throw new Error(String(result.error));
    return result.data.id;
  };
  const character = await made(store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] }));
  const module = await made(store.create('module', { name: 'Bell', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [] }));
  const prompt = await made(store.create('prompt', { name: 'P', blocks: [], toggles: [], authorNote: '', models: {} }));
  const task = await made(store.create('prompt', translatorPrompt()));
  const status = blankStatus('d', '상태');

  for (const owner of [{ kind: 'character', id: character }, { kind: 'module', id: module }, { kind: 'prompt', id: prompt }, { kind: 'prompt', id: task }] as const) await setStatus(store, owner, status);
  expect(store.get('character', character)!.value.card.status).toEqual(status);
  expect(store.get('module', module)!.value.status).toEqual(status);
  expect(store.get('prompt', prompt)!.value).toMatchObject({ status });
  expect(store.get('prompt', task)!.value).not.toHaveProperty('status');

  await setStatus(store, { kind: 'character', id: character }, undefined);
  await setStatus(store, { kind: 'prompt', id: prompt }, undefined);
  expect(store.get('character', character)!.value.card).not.toHaveProperty('status');
  expect(store.get('prompt', prompt)!.value).not.toHaveProperty('status');
});
