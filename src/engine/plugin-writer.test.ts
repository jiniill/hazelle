import { expect, it } from 'vitest';
import { pluginAskMessages, readPluginAnswer } from './plugin-writer';

it('sends the verbatim API, the account as author, the whole current file and the ask, without inventing a file for a first draft', () => {
  const api = 'declare const hazelle: Hazelle.Api;';
  expect(pluginAskMessages(api, null, '메모를 만들어 줘', 'mira')).toEqual([
    { role: 'system', content: expect.stringMatching(/\/\/@author mira[\s\S]*declare const hazelle/) },
    { role: 'user', content: '메모를 만들어 줘' },
  ]);
  expect(pluginAskMessages(api, 'const whole = `a\nb`;', '바꿔 줘', 'mira')[1]).toEqual({ role: 'user', content: 'Current file (complete):\nconst whole = `a\nb`;' });
});

it('takes the last complete js fence as the whole file and leaves unfenced answers as notes', () => {
  const earlier = '설명해요.\n```js\nold();\n```\n\n고쳤어요.';
  expect(readPluginAnswer(`${earlier}\n\n\`\`\`js\nnewFile();\n\`\`\`\n끝`)).toEqual({ ok: true, note: earlier, file: 'newFile();\n' });
  expect(readPluginAnswer('  코드를 만들 수 없어요.  ')).toEqual({ ok: false, note: '코드를 만들 수 없어요.' });
  expect(readPluginAnswer('고치는 중이에요.\n```js\nunfinished')).toEqual({ ok: false, note: '고치는 중이에요.\n```js\nunfinished' });
});
