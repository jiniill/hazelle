import type { ChatMessage } from '../connectors/types';

// author: the account's username, which a first draft is signed with; a later ask keeps the file's own.
export function pluginAskMessages(api: string, file: string | null, ask: string, author: string): ChatMessage[] {
  return [
    { role: 'system', content: `Write a Hazelle-native JavaScript plugin, never a RisuAI plugin. Follow the API definition below verbatim. Start the file with //@api 1, //@name (letters, numbers, _, . or -), //@author ${author}, //@display-name and //@version. Declare any required uses in the header. Reply with a short Korean note (1–2 sentences, 해요체), followed by the entire new file in one fenced \`\`\`js block. Never return a patch. Preserve the existing name and author unless asked to change them.\n\n${api}` },
    ...(file === null ? [] : [{ role: 'user' as const, content: `Current file (complete):\n${file}` }]),
    { role: 'user', content: ask },
  ];
}

export type PluginAnswer = { ok: true; note: string; file: string } | { ok: false; note: string };

export function readPluginAnswer(text: string): PluginAnswer {
  const blocks = [...text.matchAll(/^```js[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  const last = blocks.at(-1);
  return last ? { ok: true, note: text.slice(0, last.index).trim(), file: last[1]! } : { ok: false, note: text.trim() };
}
