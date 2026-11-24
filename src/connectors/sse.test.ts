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

it('dispatches no event whose data is empty', () => {
  const parser = new SseParser();
  expect(parser.push('data:\n\ndata: \n\ndata: a\n\n')).toEqual(['a']);
  expect(parser.push('data:\ndata:\n\n')).toEqual(['\n']);
});

it('leaves an event that has not ended untouched as its chunks come, so a long one is not copied at each, and reads it whole at a CRLF boundary split between two', () => {
  const parser = new SseParser();
  const originals = { slice: String.prototype.slice, exec: RegExp.prototype.exec };
  let longest = 0;
  const slice = vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, ...range: [number?, number?]) {
    longest = Math.max(longest, this.length);
    return originals.slice.apply(this, range);
  });
  const exec = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, text: string) {
    longest = Math.max(longest, text.length);
    return originals.exec.call(this, text);
  });
  try {
    parser.push('data: ');
    for (let i = 0; i < 200; i++) parser.push('x'.repeat(100));
    parser.push('\r\n\r');
  } finally {
    slice.mockRestore();
    exec.mockRestore();
  }
  const events = parser.push('\ndata: next\r\n\r\ndata: last');
  expect(longest).toBeLessThanOrEqual(103);
  expect([...events, ...parser.end()]).toEqual(['x'.repeat(20000), 'next', 'last']);
});
