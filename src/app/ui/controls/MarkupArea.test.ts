import { expect, it } from 'vitest';
import { linesOf } from './MarkupArea';

const textsOf = (lines: ReturnType<typeof linesOf>) => lines.map(({ runs }) => runs.map((run) => run.text));

it('draws the text a line apiece, each keeping its key and its runs when a line is put in above it', () => {
  const lines = linesOf('prompt', undefined, '# 제목\n본문\n\n끝\n');
  expect(textsOf(lines)).toEqual([['# 제목\n'], ['본문\n'], ['\n'], ['끝\n'], ['\u200b']]);
  const entered = linesOf('prompt', undefined, '\n# 제목\n본문\n\n끝\n');
  for (const { key, runs } of lines) expect(entered.find((line) => line.key === key)?.runs).toEqual(runs);
  const weighted = linesOf('tags', undefined, '(긴 머리,\n웃음:1.2), 교복');
  expect(textsOf(weighted).map((runs) => runs.join(''))).toEqual(['(긴 머리,\n', '웃음:1.2), 교복']);
  expect(weighted.flatMap(({ runs }) => runs).filter((run) => run.text.includes('\n'))).toHaveLength(1);
});
