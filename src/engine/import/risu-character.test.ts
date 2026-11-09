import { expect, it } from 'vitest';
import { risuCharacter, risuChatFile } from './risu-character';

it('counts a chat whose own toggle values Risu reads over the account, with or without its local-toggle switch on', () => {
  const chat = (over: Record<string, unknown>) => ({ message: [], ...over });
  const file = risuChatFile({
    type: 'risuAllChats',
    ver: 2,
    data: [
      chat({ useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_nsfw: '1' } }),
      chat({ GLGlobalVariables: { toggle_mode: 'b' } }),
      chat({ useLocallySetGlobalVariables: true }),
      chat({ useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: 'null', toggle_b: '', score: '3' } }),
    ],
  })!;
  expect(file.missed).toEqual([{ kind: 'chat-toggles', count: 2 }]);
});

it("reads each of Risu's memory formats into summaries ending where Risu stopped sending, and counts what stays behind", () => {
  const message = (chatId: string) => ({ role: 'user', data: chatId, chatId });
  const messages = ['a', 'b', 'c', 'd', 'e'].map(message);
  const file = risuChatFile({
    type: 'risuAllChats',
    ver: 2,
    data: [
      // An orphan names a message the chat lost; a null memo is how JSON keeps Risu's undefined.
      { message: messages, hypaV3Data: { summaries: [{ text: 'later', chatMemos: ['c', 'd'] }, { text: 'first', chatMemos: [null, 'a', 'b'] }, { text: 'orphan', chatMemos: ['gone'] }] } },
      { message: messages, hypaV2Data: { mainChunks: [{ id: 0, text: 'chunk', chatMemos: ['a', 'b', 'c'] }], chunks: [] } },
      // SupaMemory names the first message it left in the prompt.
      { message: messages, supaMemoryData: 'c\nsupa summary' },
      { message: messages, supaMemoryData: `hypa:\n${JSON.stringify([{ id: 'gone', supa: 'newest', hypa: [] }, { id: 'e', supa: 'older', hypa: [] }])}` },
      // Risu reads only one format; the newest is taken.
      { message: messages, hypaV3Data: { summaries: [{ text: 'v3', chatMemos: ['a'] }] }, supaMemoryData: 'b\nsupa' },
    ],
  })!;
  expect(file.chats.map(({ memory }) => memory)).toEqual([
    [{ text: 'first', through: 1 }, { text: 'later', through: 3 }],
    [{ text: 'chunk', through: 2 }],
    [{ text: 'supa summary', through: 1 }],
    [{ text: 'older', through: 3 }],
    [{ text: 'v3', through: 0 }],
  ]);
  expect(file.missed).toEqual([{ kind: 'memory', count: 2 }]);
});

it('brings an entry Risu switched on for one chat as a constant copy of the character’s, as its lorebook reads, and counts each', () => {
  const child = (id: string) => ({ mode: 'child', id, key: '', comment: '', content: '', alwaysActive: true, insertorder: 100, secondkey: '', selective: false });
  const chat = { message: [{ role: 'user', data: 'hi' }], localLore: [child('castle'), child('gone'), { key: 'k', comment: 'Own', content: 'mine' }] };
  const globalLore = [{ id: 'castle', key: 'castle', comment: 'Castle', content: '<char> rules', mode: 'normal', insertorder: 5 }];
  const moved = risuCharacter({ chaId: 'c', name: 'Mira', globalLore }, [chat], null, () => null);
  expect(moved.chats[0]!.lore).toMatchObject([
    { name: 'Castle', keys: [], content: '{{char}} rules', constant: true, insertionOrder: 100 },
    { name: 'Own', keys: ['k'], content: 'mine', constant: false },
  ]);
  expect(moved.missed).toEqual([{ kind: 'lore-copy', count: 1 }, { kind: 'lore-unfound', count: 1 }]);
  expect(risuChatFile({ type: 'risuChat', ver: 2, data: chat })!.missed).toEqual([{ kind: 'lore-unfound', count: 2 }]);
});

it("carries a backup character's 시작 전 설문", () => {
  const onboarding = { enabled: true, mode: 'html', html: '<div risu-change-var-name="lang" risu-change-var-value="ko">한국어</div>' };
  expect(risuCharacter({ chaId: 'c', name: 'Mira', onboarding }, [], null, () => null).card.onboarding).toMatchObject(onboarding);
});
