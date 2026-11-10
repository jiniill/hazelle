import { expect, it } from 'vitest';
import { answerJson } from './answer-json';

it('reads the outermost object or array, past words and brackets around it, and fails without one', () => {
  expect(answerJson('Here it is: {"a": [1, 2]} Hope this helps.')).toEqual({ ok: true, value: { a: [1, 2] } });
  expect(answerJson('```json\n[{"a": 1}, {"a": 2}]\n```')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2 }] });
  expect(answerJson('The scenes:\n[{"a": 1}]')).toEqual({ ok: true, value: [{ a: 1 }] });
  expect(answerJson('Records [2]: {"records": [1]}')).toEqual({ ok: true, value: { records: [1] } });
  expect(answerJson('The {two} scenes: [{"a": 1}]')).toEqual({ ok: true, value: [{ a: 1 }] });
  expect(answerJson('No picture fits this message.')).toEqual({ ok: false });
});
