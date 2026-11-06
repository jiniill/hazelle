import { describe, expect, it } from 'vitest';
import { GUIDES, spans } from './guides';

describe('guides', () => {
  it('reads a control name in 「」 apart from the words around it', () => {
    expect(spans("'로컬 백업 저장' 다음 「백업 읽기」를 눌러요.")).toEqual([
      { text: "'로컬 백업 저장' 다음 ", control: false },
      { text: '백업 읽기', control: true },
      { text: '를 눌러요.', control: false },
    ]);
  });

  it('gives every section an anchor of its own', () => {
    for (const guide of GUIDES) expect(new Set(guide.sections.map((section) => section.id)).size).toBe(guide.sections.length);
  });
});
