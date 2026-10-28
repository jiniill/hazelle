import { expect, it } from 'vitest';
import { DIRECT_TYPE } from '../../contracts/pulse';
import { belowNames, hourDetail, percent, providerName, rankRows, weekText } from './board';

it('names a provider by its connection type, 직접 연결 for the generic one, and none for a type this build does not list', () => {
  expect(providerName('openrouter')).toBe('OpenRouter');
  expect(providerName(DIRECT_TYPE)).toBe('직접 연결');
  expect(providerName('from-a-newer-build')).toBeNull();
});

it('ranks the split view without the rows it cannot name, and puts 기타 last without a place, its bar against the largest', () => {
  const ranking = {
    merged: [
      { key: '', model: null, share: 0.5, people: 40, replies: 5000 },
      { key: 'glm 5.2', model: 'GLM 5.2', share: 0.25, people: 1200, replies: 2500 },
    ],
    split: [
      { key: 'glm 5.2', model: 'GLM 5.2', type: 'from-a-newer-build', share: 0.5, people: 900 },
      { key: '', model: null, type: DIRECT_TYPE, share: 0.003, people: 7 },
    ],
  };
  const [first, others] = rankRows(ranking, null, false, false);
  expect(first).toEqual({ key: 'glm 5.2\0', rank: 1, name: 'GLM 5.2', note: '응답 2,500번 · 이번 주 1,200명', value: '25%', share: 0.5 });
  expect(others).toMatchObject({ key: '\0', rank: null, name: '기타', note: '응답 5,000번 · 이번 주 40명', value: '50%', share: 1 });
  expect(others?.help).toBeTruthy();
  expect(rankRows(ranking, null, true, false)).toMatchObject([{ key: `\0${DIRECT_TYPE}`, rank: null, name: '기타', note: '직접 연결 · 이번 주 7명', value: '1% 미만', share: 1 }]);
  expect(rankRows(ranking, null, false, true)[0]?.note).toBe('응답 2,500번 · 1,200명');
  expect(percent(0)).toBe('0%');
});

it('closes the 대화 list with the rows below the floor, its bar against the largest, and leaves it out when there are none', () => {
  const row = { key: 'a', model: 'A', share: 0.25, people: 6, replies: 40 };
  const rest = { merged: { share: 0.75, replies: 130 }, split: { share: 0, replies: 0 } };
  expect(rankRows({ merged: [row], split: [], rest }, null, false, false)).toMatchObject([
    { name: 'A', value: '25%', share: 1 / 3 },
    { rank: null, name: '순위 밖 모델', note: '응답 130번', value: '75%', share: 1 },
  ]);
  expect(rankRows({ merged: [], split: [], rest }, null, true, false)).toEqual([]);
});

it('names the rows below the floor in the server order, with the provider in the split view, and none where none are listed', () => {
  const below = {
    merged: [{ key: 'b', model: 'B' }, { key: 'a', model: 'A' }],
    split: [{ key: 'b', model: 'B', type: 'openrouter' }, { key: 'a', model: 'A', type: 'from-a-newer-build' }, { key: 'c', model: 'C', type: 'openrouter' }],
  };
  expect(belowNames({ merged: [], split: [], below }, false)).toEqual(['B', 'A']);
  expect(belowNames({ merged: [], split: [], below }, true)).toEqual(['B (OpenRouter)', 'C (OpenRouter)']);
  expect(belowNames({ merged: [], split: [] }, false)).toEqual([]);
});

it('marks a move against the earlier places counted by the same rules, and nothing where the earlier period was not whole', () => {
  const row = (key: string, type?: string) => ({ key, model: key || null, ...(type && { type }), share: 0.1, people: 10 });
  const ranking = { merged: [row('a'), row('b'), row('c'), row('d'), row('')], split: [row('a', 'openrouter'), row('b', 'openrouter')] };
  const before = {
    merged: [{ key: '' }, { key: 'c' }, { key: 'b' }, { key: 'a' }],
    split: [{ key: 'b', type: 'from-a-newer-build' }, { key: 'b', type: 'openrouter' }, { key: 'a', type: 'openrouter' }],
  };
  const moves = (split: boolean) => rankRows(ranking, before, split, false).map((each) => each.move?.text);
  expect(moves(false)).toEqual(['▲2', undefined, '▼2', 'NEW', undefined]);
  expect(rankRows(ranking, before, false, false)[0]?.move?.label).toBe('2계단 상승');
  expect(moves(true)).toEqual(['▲1', '▼1']);
  expect(rankRows(ranking, null, false, false).some((each) => each.move)).toBe(false);
});

it('tells a week by its Monday in KST, and an hour by its replies first, then the roles it had', () => {
  expect(weekText(Date.UTC(2026, 9, 11, 15))).toBe('10월 12일 주');
  expect(hourDetail({ chat: 120, aux: 0, image: 10, embedding: 0 })).toBe('응답 120번 · 이미지 10번');
});
