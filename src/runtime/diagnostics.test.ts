import { describe, expect, it } from 'vitest';
import { MAX_DIAGNOSTICS_LENGTH } from '../contracts/board';
import { errorText } from './evaluation-core';
import { noteProblem, recentProblems, reportText } from './diagnostics';

const DEVICE = { userAgent: 'Mozilla/5.0 (iPhone)', language: 'ko-KR', screen: '402×874 @3 · 창 402×760', cores: 6, memory: null, standalone: false, online: true };

describe('diagnostics', () => {
  it('keeps a problem said again in a row as one line, and only the last twenty', () => {
    noteProblem('a', 1);
    noteProblem('a', 2);
    expect(recentProblems().filter(({ text }) => text === 'a')).toEqual([{ at: 1, text: 'a' }]);
    for (let i = 0; i < 30; i++) noteProblem(`n${i}`, i);
    expect(recentProblems()).toHaveLength(20);
    expect(recentProblems()[19]).toEqual({ at: 29, text: 'n29' });
  });

  it('reports the device, the tokenizer check and each problem', () => {
    const text = reportText({ version: 'v1.2.3', now: 0, device: DEVICE, tokenizer: '실패 · 12ms · RangeError: Out of memory', state: { dropped: 3 }, problems: [{ at: 1000, text: '토큰 수를 계산하지 못했어요.' }] });
    expect(text.split('\n')).toEqual([
      '헤이젤 진단 정보',
      '시각: 1970-01-01T00:00:00.000Z',
      '버전: v1.2.3',
      '브라우저: Mozilla/5.0 (iPhone)',
      '언어: ko-KR',
      '화면: 402×874 @3 · 창 402×760',
      '코어: 6 · 메모리: 알 수 없음',
      '홈 화면 앱: 아니요 · 온라인: 예',
      '토크나이저: 실패 · 12ms · RangeError: Out of memory',
      '앱 상태: {',
      ' "dropped": 3',
      '}',
      '최근 오류:',
      '- 1970-01-01T00:00:01.000Z 토큰 수를 계산하지 못했어요.',
    ]);
    expect(reportText({ version: null, now: 0, device: DEVICE, tokenizer: '불러옴', state: {}, problems: [] })).toContain('버전: 알 수 없음\n');
  });

  it('leaves out the oldest problems when the report would not fit a post, and says how many', () => {
    const problems = Array.from({ length: 40 }, (_, at) => ({ at, text: 'x'.repeat(1000) }));
    const text = reportText({ version: null, now: 0, device: DEVICE, tokenizer: '불러옴', state: {}, problems });
    expect(text.length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_LENGTH);
    expect(text).toMatch(/- 오래된 오류 \d+줄 생략/);
    expect(text).toContain(`${new Date(39).toISOString()} ${'x'.repeat(500)}`);
    expect(reportText({ version: null, now: 0, device: DEVICE, tokenizer: '불러옴', state: { fills: 'x'.repeat(20000) as never }, problems: [] })).toHaveLength(MAX_DIAGNOSTICS_LENGTH);
  });

  it('says an error with its name and the first lines of its stack', () => {
    const error = new TypeError('Importing a module script failed.');
    error.stack = 'one\ntwo\nthree\nfour\nfive';
    expect(errorText(error)).toBe('TypeError: Importing a module script failed.\none\ntwo\nthree');
    error.stack = 'TypeError: Importing a module script failed.\n    at one';
    expect(errorText(error)).toBe('TypeError: Importing a module script failed.\n    at one');
    expect(errorText('plain')).toBe('plain');
  });
});
