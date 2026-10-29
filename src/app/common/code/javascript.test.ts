import { expect, it } from 'vitest';
import { jsLanguage } from './javascript';

const header = '//@menu notes 메모\n';

it('marks the refused header line and fixes a nearby use, leaving clean bodies unmarked', async () => {
  const language = jsLanguage();
  const line = '  //@uses networking';
  const text = `${header}${line}\nhazelle.on("prompt", () => "");`;
  const problems = await language.lint(text);
  expect(problems).toEqual([{ from: header.length, to: header.length + line.length, severity: 'error', message: '//@uses에는 model, embed, memory, network만 쓸 수 있어요.', fix: { label: 'network로 바꾸기', insert: '  //@uses network' } }]);
  const [problem] = problems;
  expect(await language.lint(text.slice(0, problem!.from) + problem!.fix!.insert + text.slice(problem!.to))).toEqual([]);
  expect(await language.lint('const x = 1;')).toEqual([]);
  expect((await language.lint(`${header}//@uses impossible`))[0]!.fix).toBeUndefined();
});

it('marks identity lines in the body, which the 정보 tab owns', async () => {
  expect(await jsLanguage().lint(`${header}//@version 2.0.0\nconst x = 1;`)).toEqual([{ from: header.length, to: header.length + '//@version 2.0.0'.length, severity: 'error', message: '이 줄은 정보 탭에서 바꿔요.' }]);
});
