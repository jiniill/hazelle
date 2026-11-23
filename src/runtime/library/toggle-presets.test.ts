import { describe, expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { testServer } from '../testing';
import { togglePresets } from './toggle-presets';

const server = testServer();

describe('toggle presets', () => {
  it("are kept by the prompt or the card that declares the toggles, renamed and overwritten in place, and a removal's undo puts one back where it stood", async () => {
    const { store } = await server.account();
    const prompt = await store.create('prompt', { name: 'P', blocks: [], toggles: [], authorNote: '', models: {} });
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    if (!prompt.ok || !character.ok) throw new Error('not made');
    const onPrompt = togglePresets(store, { from: 'prompt', id: prompt.data.id });
    const onCard = togglePresets(store, { from: 'card', id: character.data.id });
    const promptPresets = () => {
      const value = store.get('prompt', prompt.data.id)!.value;
      return value.task === undefined ? value.togglePresets : null;
    };

    await onPrompt.add({ id: 'a', name: '소설', values: { sims: '0' } });
    await onPrompt.add({ id: 'b', name: 'RP', values: { sims: '1' } });
    await onCard.add({ id: 'c', name: '폭풍', values: { storm: '1' } });
    await onPrompt.edit('a', { name: '소설풍', values: { sims: '2' } });
    const removed = await onPrompt.remove('a');
    if (!removed.ok) throw new Error(removed.error);
    expect(promptPresets()).toEqual([{ id: 'b', name: 'RP', values: { sims: '1' } }]);

    await onPrompt.restore(removed.data);
    expect(promptPresets()!.map(({ id, name }) => [id, name])).toEqual([['a', '소설풍'], ['b', 'RP']]);
    expect(store.get('character', character.data.id)!.value.card.togglePresets).toEqual([{ id: 'c', name: '폭풍', values: { storm: '1' } }]);
  });
});
