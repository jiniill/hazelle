import { expect, it } from 'vitest';
import { pluginAskMessages, readPluginAnswer } from './plugin-writer';

it('sends the verbatim API ahead of the body and the ask, and asks a new file for its name', () => {
  const api = 'declare const hazelle: Hazelle.Api;';
  const [system, first] = pluginAskMessages(api, null, '메모를 만들어 줘');
  expect(system).toEqual({ role: 'system', content: expect.stringMatching(/declare const hazelle: Hazelle\.Api;$/) });
  expect(first).toEqual({ role: 'user', content: expect.stringMatching(/\/\/@display-name[\s\S]*Request:\n메모를 만들어 줘$/) });
  expect(pluginAskMessages(api, 'const whole = `a\nb`;', '바꿔 줘')).toEqual([system, { role: 'user', content: expect.stringContaining('const whole = `a\nb`;\n\nRequest:\n바꿔 줘') }]);
});

it('takes the last complete js or javascript fence as the body, the identity lines split off, and leaves unfenced answers as notes', () => {
  const earlier = '설명해요.\n```js\nold();\n```\n\n고쳤어요.';
  expect(readPluginAnswer(`${earlier}\n\n\`\`\`javascript\n//@display-name 메모\n//@version 9.0.0\n//@uses model\nnewFile();\n\`\`\`\n끝`)).toEqual({ ok: true, note: earlier, body: '//@uses model\n\nnewFile();\n', proposed: { displayName: '메모' } });
  expect(readPluginAnswer('  코드를 만들 수 없어요.  ')).toEqual({ ok: false, note: '코드를 만들 수 없어요.' });
  expect(readPluginAnswer('고치는 중이에요.\n```js\nunfinished')).toEqual({ ok: false, note: '고치는 중이에요.\n```js\nunfinished' });
});
