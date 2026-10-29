import { describe, expect, it } from 'vitest';
import { blankCard } from '../engine/import/card';
import { EMPTY_SETTINGS } from '../model/settings';
import { above, chatIllustrate, chatTranslate, featuresOf, inherited, setFeatureAt } from './features';
import { addPrompt } from './prompts';
import { setIllustrate, setTranslate } from './characters';
import { testServer } from './testing';

const server = testServer();

describe('features', () => {
  it('reads the nearest layer that sets a feature, chat, character, prompt, then 공용, and starts as FEATURE_STARTS has it where none does', () =>
    server.withSession(async ({ store }) => {
      const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
      const prompt = await addPrompt(store, '짝', 'conversation');
      if (!character.ok || !prompt.ok) throw new Error('not created');
      const created = await store.create('chat', { title: null, character: character.data.id, prompt: prompt.data.id, models: {} });
      if (!created.ok) throw new Error(created.error);
      const chat = () => store.get('chat', created.data.id)!.value;
      const at = { settings: { kind: 'settings' }, prompt: { kind: 'prompt', id: prompt.data.id }, character: { kind: 'character', id: character.data.id }, chat: { kind: 'chat', id: created.data.id } } as const;

      expect(featuresOf(store, chat())).toEqual({ translate: true, illustrate: true, memory: true, mascot: false, preread: false, agents: false });
      await setFeatureAt(store, at.character, 'mascot', true);
      expect(featuresOf(store, chat()).mascot).toBe(true);
      await setFeatureAt(store, at.character, 'mascot', null);
      expect([above(at.prompt), above(at.character), above({ kind: 'chat', chat: chat() })]).toEqual(['settings', 'prompt', 'character']);

      for (const layer of ['settings', 'prompt', 'character', 'chat'] as const) {
        await setFeatureAt(store, at[layer], 'memory', false);
        expect(featuresOf(store, chat()).memory).toBe(false);
        await setFeatureAt(store, at[layer], 'memory', null);
        expect(featuresOf(store, chat()).memory).toBe(true);
      }

      await setFeatureAt(store, at.settings, 'translate', false);
      await setFeatureAt(store, at.prompt, 'translate', true);
      expect(featuresOf(store, chat()).translate).toBe(true);
      await setFeatureAt(store, at.character, 'translate', false);
      expect(featuresOf(store, chat()).translate).toBe(false);
      expect(inherited(store, { kind: 'chat', chat: chat() }).translate).toBe(false);
      await setFeatureAt(store, at.chat, 'translate', true);
      expect(featuresOf(store, chat()).translate).toBe(true);
      expect(inherited(store, at.prompt).translate).toBe(false);

      await setFeatureAt(store, at.chat, 'translate', null);
      expect(chat().features).toBeUndefined();
    }));

  it('reads a new chat not stored yet by its value: it follows its character', () =>
    server.withSession(async ({ store }) => {
      const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
      if (!character.ok) throw new Error('not created');
      await setFeatureAt(store, { kind: 'character', id: character.data.id }, 'translate', false);
      const unsaved = { kind: 'chat', chat: { title: null, character: character.data.id, models: {} } } as const;
      expect(above(unsaved)).toBe('character');
      expect(inherited(store, unsaved).translate).toBe(false);
    }));

  it("turns a chat's running switches off with its feature, and keeps the rest", () =>
    server.withSession(async ({ store }) => {
      await setTranslate(store, null, { replies: true, input: true, replyLanguage: 'Japanese' });
      await setIllustrate(store, null, { auto: true });
      const created = await store.create('chat', { title: null, character: null, models: {}, features: { translate: false, illustrate: false } });
      if (!created.ok) throw new Error(created.error);
      const chat = store.get('chat', created.data.id)!.value;
      expect(chatTranslate(store, chat)).toMatchObject({ replies: false, input: false, reverse: false, replyLanguage: 'Japanese' });
      expect(chatIllustrate(store, chat).auto).toBe(false);
      expect(chatTranslate(store, { character: null }).replies).toBe(true);
    }));

  it('reads an experiment off on every layer while its 실험실 switch is off', () =>
    server.withSession(async ({ store }) => {
      const created = await store.create('chat', { title: null, character: null, models: {}, features: { preread: true } });
      if (!created.ok) throw new Error(created.error);
      const chat = () => store.get('chat', created.data.id)!.value;
      expect(featuresOf(store, chat()).preread).toBe(false);
      await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, labs: ['preread'] }));
      expect(featuresOf(store, chat()).preread).toBe(true);
    }));
});
