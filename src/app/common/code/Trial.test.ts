import { expect, it } from 'vitest';
import type { Trial } from '../../../runtime/scripts/preview';
import { trialFacts } from './Trial';

it("lists what a run did, then a caller's own rows, then what it was kept from", () => {
  const trial = {
    said: [{ tone: 'normal', text: '안녕' }],
    asked: [],
    calls: { model: 1, embed: 0, background: 0, fetch: 2 },
    loreRanAway: false,
    outcome: { added: [{}], edits: [], removed: [], lore: [] },
  } as unknown as Trial;
  expect(trialFacts(trial, [{ label: '저장소', value: 'key' }])).toEqual([
    { label: '알림 표시', value: '안녕' },
    { label: '메시지 추가', value: '1개' },
    { label: '저장소', value: 'key' },
    { label: '생략된 모델 호출', value: '1번' },
    { label: '생략된 네트워크 요청', value: '2번' },
  ]);
});
