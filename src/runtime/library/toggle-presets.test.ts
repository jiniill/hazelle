import { describe, expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { testServer } from '../testing';
import { addTogglePreset, editTogglePreset, removeTogglePreset, restoreTogglePreset } from './toggle-presets';

const server = testServer();

describe('toggle presets', () => {
  it("are kept by the prompt or the card that declares the toggles, renamed and overwritten in place, and a removal's undo puts one back where it stood", async () => {
    const { store } = await server.account();
    const prompt = await store.create('prompt', { name: 'P', blocks: [], toggles: [], authorNote: '', models: {} });
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    if (!prompt.ok || !character.ok) throw new Error('not made');
    const onPrompt = { from: 'prompt', id: prompt.data.id } as const;
    const onCard = { from: 'card', id: character.data.id } as const;
    const promptPresets = () => {
      const value = store.get('prompt', prompt.data.id)!.value;
      return value.task === undefined ? value.togglePresets : null;
    };

    await addTogglePreset(store, onPrompt, { id: 'a', name: '소설', values: { sims: '0' } });
    await addTogglePreset(store, onPrompt, { id: 'b', name: 'RP', values: { sims: '1' } });
    await addTogglePreset(store, onCard, { id: 'c', name: '폭풍', values: { storm: '1' } });
    await editTogglePreset(store, onPrompt, 'a', { name: '소설풍', values: { sims: '2' } });
    const removed = await removeTogglePreset(store, onPrompt, 'a');
    if (!removed.ok) throw new Error(removed.error);
    expect(promptPresets()).toEqual([{ id: 'b', name: 'RP', values: { sims: '1' } }]);

    await restoreTogglePreset(store, onPrompt, removed.data);
    expect(promptPresets()!.map(({ id, name }) => [id, name])).toEqual([['a', '소설풍'], ['b', 'RP']]);
    expect(store.get('character', character.data.id)!.value.card.togglePresets).toEqual([{ id: 'c', name: '폭풍', values: { storm: '1' } }]);
  });
});
