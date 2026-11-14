import { storyHtml } from '../../engine/display';

// One made-up chat for every place that shows how a look reads: a preset's card, 디스플레이's preview, a theme's
// picture of the app.
export const LOOK_SAMPLE = '그녀는 찻잔을 내려놓고 고개를 들었다.';
const CHARACTER = '캐릭터';
export const LOOK_CHAT = {
  character: CHARACTER,
  // Whose chats the rail holds, the open one first, and that one's chats, the open one first.
  faces: [CHARACTER, '친구', '선생님'],
  chats: ['비 오는 오후', '도서관에서', '첫 만남', '늦은 저녁'],
  rows: [
    { name: CHARACTER, mine: false, html: storyHtml(`*창밖으로 늦은 오후의 햇살이 기울어 든다.* ${LOOK_SAMPLE} "오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아." '또 잠든 건 아니겠지.'`, true) },
    { name: '나', mine: true, html: storyHtml('"이번엔 끝까지 읽었어. 결말이 좀 의외던데."', false) },
  ],
};
