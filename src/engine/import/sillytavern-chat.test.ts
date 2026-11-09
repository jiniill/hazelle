import { expect, it } from 'vitest';
import { sillyTavernChat } from './sillytavern-chat';

const lines = (...rows: object[]) => rows.map((row) => JSON.stringify(row)).join('\n');
const header = { user_name: 'unused', character_name: 'unused', create_date: '2024-7-12@01h31m37s', chat_metadata: { note_prompt: '비가 와요', variables: { hp: 7, mood: '맑음' } } };

it("reads SillyTavern's chat file into a chat: its greeting by its swipe, swipes as versions, what does not come counted", () => {
  const file = lines(
    header,
    { name: '루나', is_user: false, is_system: false, send_date: '2024-07-12T01:31:37.000Z', mes: '둘째 인사', swipe_id: 1, swipes: ['첫 인사', '둘째 인사'], extra: {} },
    { name: '나', is_user: true, is_system: false, send_date: 'June 19, 2023 2:20pm', mes: '안녕', extra: { media: [{ url: 'a.png' }], files: [{ url: 'b.txt' }] } },
    {
      name: '루나', is_user: false, send_date: '2024-07-12T01:33:00.000Z', mes: '셋째 답', swipe_id: 2,
      swipes: ['첫 답', '둘째 답', '낡은 셋째'],
      swipe_info: [{ send_date: '2024-07-12T01:32:00.000Z', extra: { reasoning: '먼저 생각' } }, { send_date: 1720748000000, extra: {} }, {}],
      extra: { reasoning: '마지막 생각' },
    },
    { name: 'System', is_user: false, is_system: false, send_date: '', mes: '해가 졌다.', extra: { type: 'narrator' } },
    { name: 'Note', is_user: false, is_system: true, mes: '메모', extra: { type: 'comment' } },
  );
  const read = sillyTavernChat(`${file}\n`, '루나 - 2024-7-12@01h31m37s')!;
  const [chat] = read.chats;
  expect(chat).toMatchObject({ title: '루나 - 2024-7-12@01h31m37s', note: '비가 와요', greeting: 1, variables: [['hp', '7'], ['mood', '맑음']] });
  expect(chat!.messages).toEqual([
    { role: 'user', text: '안녕', at: new Date(2023, 5, 19, 14, 20).getTime() },
    {
      role: 'assistant', text: '첫 답', at: Date.parse('2024-07-12T01:32:00.000Z'), reasoning: '먼저 생각',
      versions: { later: [{ text: '둘째 답', at: 1720748000000 }, { text: '셋째 답', at: Date.parse('2024-07-12T01:33:00.000Z'), reasoning: '마지막 생각' }], selected: 2 },
    },
    // A date it cannot read keeps the one before it.
    { role: 'assistant', text: '해가 졌다.', at: Date.parse('2024-07-12T01:33:00.000Z') },
    { role: 'assistant', text: '메모', at: Date.parse('2024-07-12T01:33:00.000Z') },
  ]);
  expect(read.missed).toEqual([
    { kind: 'inlay', count: 1 },
    { kind: 'hidden-message', count: 1 },
    { kind: 'system-message', count: 1 },
    { kind: 'attachment', count: 1 },
  ]);
});

it("takes a chat that opens with the user's message whole, and refuses any other text", () => {
  const read = sillyTavernChat(lines(header, { name: '나', is_user: true, send_date: 5, mes: '먼저 말해요' }), 'chat')!;
  expect(read.chats[0]).toMatchObject({ greeting: 0, messages: [{ role: 'user', text: '먼저 말해요', at: 5 }] });
  expect(sillyTavernChat(lines({ type: 'risuChat' }, { mes: 'x' }), 'chat')).toBeNull();
  expect(sillyTavernChat(`${lines(header)}\nnot json`, 'chat')).toBeNull();
});
