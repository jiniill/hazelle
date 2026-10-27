import { blankCard } from '../../../engine/import/card';
import { renderAfter } from '../../../engine/pipeline';
import type { ChatScope } from '../../../engine/render';

// The chat every guide example and 시험해 보기's 예시 채팅 runs in, which SAMPLE_NOTE describes to the reader. Its seed
// and clock are fixed, so an example gives the result written beside it; guides.test.ts runs every one.
// What the sample passes for {{language}}; a real chat passes null, as its conversation prompt does.
export const SAMPLE_LANGUAGE = 'Korean';

export const SAMPLE: ChatScope = {
  card: blankCard('미라'),
  cast: [],
  packs: [],
  persona: { name: '나', description: '' },
  prompt: null,
  promptOut: false,
  note: null,
  lore: [],
  loreFolders: {},
  loreScan: { scanDepth: 5, tokenBudget: 0, recursive: false, fullWordMatching: false },
  messages: [
    { id: 'm1', message: 'm1', seed: 'm1', role: 'user', text: '안녕', time: null },
    { id: 'm2', message: 'm2', seed: 'm2', role: 'assistant', text: '안녕, 나. 비가 와서 우산을 챙겼어.', time: null },
  ],
  variables: [
    ['호감도', '30'],
    ['날씨', '비'],
    ['가방', '["나침반","지도"]'],
  ],
  greeting: null,
  toggles: new Map([['존댓말', '1']]),
  model: null,
  axModel: null,
  clock: { now: Date.UTC(2026, 9, 1, 3), timeZone: 'Asia/Seoul' },
  assets: [],
  inlays: [],
  textfiles: [],
  modules: [],
  faces: { char: null, user: null },
  screen: null,
  pick: 'sample',
};

export const SAMPLE_NOTE = '예시 채팅: 캐릭터 미라, 페르소나 나, 채팅 변수 호감도=30 · 날씨=비 · 가방=["나침반","지도"], 토글 존댓말 켬';

// inMessage: the example runs as a chat message's own text, the only place setvar and addvar write. null: its
// commands ran away and were stopped.
export function tryExample(written: string, inMessage = false): string | null {
  const result = renderAfter(SAMPLE, written, inMessage ? { message: 0 } : { seed: 'sample' }, SAMPLE_LANGUAGE);
  return typeof result === 'string' ? result : null;
}
