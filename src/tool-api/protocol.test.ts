import { expect, it } from 'vitest';
import { called } from './protocol';

it('names a method as a plugin\'s code calls it', () => {
  expect(['chat.data.get', 'model', 'say', 'chat.card.edit', 'settings', 'settings.set', 'storage.keys', 'frame.show'].map(called))
    .toEqual(['chat.data.get', 'chat.model', 'chat.say', 'chat.editCard', 'hazelle.settings', 'hazelle.setSetting', 'hazelle.storage.keys', 'hazelle.frame.show']);
});
