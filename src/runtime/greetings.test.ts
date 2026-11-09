import { expect, it } from 'vitest';
import { fold, shown, type Chat, type Entry } from '../model/chat';
import type { Stored } from '../model/kinds';
import { chatWrites, editMessage, appendScripted } from './chat-log';
import { greetingOf, greetingPreview, projectGreetings, startingGreetings } from './greetings';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

const chat: Chat = { title: null, character: 'character', models: {} };
const entries = (writes: Write[]): Stored<'entry'>[] => writes.flatMap((write, index) =>
  write.type === 'create' && write.kind === 'entry' ? [{ id: write.id, kind: 'entry', parent: write.parent, rev: index + 1, value: write.value as Entry }] : []);

it('preserves original indexes, blank choices, duplicate text, ids and translations from preview through saving', () => {
  const texts = ['', 'A', '', 'A', 'B'];
  const ids = texts.map((_, index) => `g${index}`);
  const translation = { text: 'translated', receipt: null, at: 0 };
  for (const selected of [0, 1, 2, 3, 4]) {
    const choices = projectGreetings(texts, ids, selected, () => translation)!;
    const preview = greetingPreview(choices, 0)!;
    const saved = startingGreetings(choices);
    const messages = fold(entries(chatWrites('chat', chat, saved, null).entries));
    expect(preview.versions.map(({ greeting }) => greeting)).toEqual([0, 1, 2, 3, 4]);
    if (texts[selected] === '') {
      expect(saved).toBeNull();
      expect(messages).toEqual([]);
      expect(greetingOf([preview])).toBeNull();
    } else {
      expect(messages[0]!.id).toBe(preview.id);
      expect(shown(messages[0]!).id).toBe(ids[selected]);
      expect(shown(messages[0]!).translation).toEqual(translation);
      expect(greetingOf(messages)).toEqual({ index: selected });
      expect(greetingOf(messages)).toEqual(greetingOf([preview]));
    }
  }
  expect(projectGreetings(texts, ids, null)?.selected).toBe(1);
  expect(projectGreetings(texts, ids, 8)?.selected).toBe(1);
  expect(projectGreetings(['', ' '], ['a', 'b'], null)).toBeNull();
});

it('saves only the greetings that say something, each under its card index', () => {
  const saved = startingGreetings(projectGreetings(['', 'a', '', 'b'], ['g0', 'g1', 'g2', 'g3'], 3))!;
  const message = fold(entries(chatWrites('chat', chat, saved, null).entries))[0]!;
  expect(message.versions.map(({ text, greeting }) => [text, greeting])).toEqual([['a', 1], ['b', 3]]);
  expect(shown(message).id).toBe('g3');
});

it('keeps greeting identity through user and script edits instead of matching their new text', async () => {
  const choices = projectGreetings(['', 'same', 'same'], ['g0', 'g1', 'g2'], 2)!;
  const held = entries(chatWrites('chat', chat, choices, null).entries);
  const store = {
    create: async (_kind: string, value: Entry) => {
      held.push({ id: crypto.randomUUID(), kind: 'entry', parent: 'chat', rev: held.length + 1, value });
      return { ok: true, data: held.at(-1) };
    },
    batch: async (writes: Write[]) => {
      held.push(...entries(writes));
      return { ok: true, data: null };
    },
  } as unknown as ObjectStore;
  await editMessage(store, 'chat', fold(held)[0]!, 'edited', null);
  expect(greetingOf(fold(held))).toEqual({ index: 2 });
  await appendScripted(store, 'chat', { edits: [{ message: fold(held)[0]!, text: 'scripted', wrote: [] }], removed: [], added: [], vars: null });
  expect(greetingOf(fold(held))).toEqual({ index: 2 });
});
