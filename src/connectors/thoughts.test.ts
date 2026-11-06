import { describe, expect, it } from 'vitest';
import { thoughtRuns, thoughts } from './thoughts';

// The answer fed in every chunk size, so each tag is also split at every place; every size must read the same.
function read(answer: string, finished = true) {
  const results = new Set<string>();
  for (let size = 1; size <= answer.length; size += 1) {
    const parts = { text: '', reasoning: '' };
    const scanner = thoughts(
      (phase, chunk) => (parts[phase] += chunk),
      (chars) => (parts.reasoning = parts.reasoning.slice(0, parts.reasoning.length - chars)),
    );
    for (let at = 0; at < answer.length; at += size) scanner.push('text', answer.slice(at, at + size));
    scanner.end(finished);
    results.add(JSON.stringify(parts));
  }
  expect(results.size).toBe(1);
  return JSON.parse([...results][0]!) as { text: string; reasoning: string };
}

describe('thoughts', () => {
  it('moves blocks anywhere to the reasoning, trimmed and a blank line apart, and trims the text a leading one leaves', () => {
    expect(read('\n<think>\n계획 \n</think>\n\n안녕.<thinking>둘째</thinking> 끝')).toEqual({ text: '안녕. 끝', reasoning: '계획\n\n둘째' });
  });

  it('matches in any case, ignores attributes, and reads Kimi’s marks', () => {
    expect(read('<THOUGHTS kind="a">하나</Thoughts><antthinking>둘</ANTTHINKING>◁think▷셋◁/think▷답')).toEqual({ text: '답', reasoning: '하나\n\n둘\n\n셋' });
  });

  it('keeps a closer with no block open, and a near-miss opener, as text', () => {
    expect(read('a</think> <thinker> <think')).toEqual({ text: 'a</think> <thinker> <think', reasoning: '' });
  });

  it('gives a block left open back as text when the answer finished, and keeps it as reasoning when cut', () => {
    expect(read('<think>a</think>앞 <think>열린 채 </thi')).toEqual({ text: '앞 <think>열린 채 </thi', reasoning: 'a' });
    expect(read('<think>a</think>앞 <think>열린 채 </thi', false)).toEqual({ text: '앞 ', reasoning: 'a\n\n열린 채 </thi' });
  });
});

it('runs each block apart where text stands between, joins adjacent ones, and gives an unclosed one back to the text', () => {
  expect(thoughtRuns('<think>a</think> x <think>b</think><think>c</think>y <think>open')).toEqual([
    { phase: 'reasoning', text: 'a' },
    { phase: 'text', text: 'x ' },
    { phase: 'reasoning', text: 'b\n\nc' },
    { phase: 'text', text: 'y <think>open' },
  ]);
});
