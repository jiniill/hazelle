import { expect, it } from 'vitest';
import { jsLanguage } from './javascript';

const header = '//@api 1\n//@name notes\n//@author jin\n';

it('marks the refused header line and fixes a nearby use, leaving clean files unmarked', async () => {
  const language = jsLanguage();
  const line = '  //@uses networking';
  const text = `${header}${line}\nhazelle.on("prompt", () => "");`;
  const problems = await language.lint(text);
  expect(problems).toEqual([{ from: header.length, to: header.length + line.length, severity: 'error', message: '//@uses에는 model, embed, memory, network만 쓸 수 있어요.', fix: { label: 'network로 바꾸기', insert: '  //@uses network' } }]);
  const [problem] = problems;
  expect(await language.lint(text.slice(0, problem!.from) + problem!.fix!.insert + text.slice(problem!.to))).toEqual([]);
  expect(await language.lint(header)).toEqual([]);
  expect(await language.lint(`${header}//@uses impossible`)).toEqual([expect.objectContaining({ severity: 'error' })]);
  expect((await language.lint(`${header}//@uses impossible`))[0]!.fix).toBeUndefined();
  expect(await language.lint('const x = 1;')).toEqual([expect.objectContaining({ from: 0, to: 12 })]);
});
