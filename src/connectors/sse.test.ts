import { expect, it, vi } from 'vitest';
import { SseParser } from './sse';

it('scans only new text plus a split boundary, then resets for the next event', () => {
  const parser = new SseParser();
  const original = RegExp.prototype.exec;
  let searched = 0;
  const exec = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, text: string) {
    if (this.source === /\r?\n\r?\n/.source) searched += text.length - this.lastIndex;
    return original.call(this, text);
  });
  try {
    parser.push('data: ');
    for (let i = 0; i < 100; i++) expect(parser.push('x'.repeat(100))).toEqual([]);
    expect(parser.push('\r\n\r')).toEqual([]);
    expect(parser.push('\ndata: next\n\n')).toEqual(['x'.repeat(10000), 'next']);
    expect(searched).toBeLessThan(11000);
  } finally {
    exec.mockRestore();
  }
});
