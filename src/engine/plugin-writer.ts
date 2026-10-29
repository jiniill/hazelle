import type { ChatMessage } from '../connectors/types';
import type { ToolIdentity } from '../model/tool';
import { splitTool } from './import/tool';

// The rules and the API come first and never change, so the provider can cache them; the file and the ask follow.
const RULES = `You write Hazelle plugins: one JavaScript file that the Hazelle chat app runs. They are not RisuAI plugins, and RisuAI's API does not exist here.

The app writes the file's identity lines itself: //@api, //@name, //@author, //@version, //@display-name and //@description. Never write them, except //@display-name and //@description when the request says the file is new.

The file starts with its header: //@ lines, one per line, before any code. Any other //@ key makes the file unreadable.
- //@uses model | embed | memory | network: one line for each ability the code calls. model: chat.model or chat.send. embed: chat.embed. memory: a prompt answer with memory. network: chat.fetch.
- //@setting {"key":"…","label":"…","type":"text"|"number"|"switch"|"choice","options":["…"],"default":…,"composer":true}: one field on the plugin's page, as JSON on one line. options only for choice. composer: true also shows the field from the chat input's button, which needs //@composer.
- //@composer <label>: that button beside the chat input, at most 8 characters.
- //@input <id> <label>: an item of that button, at most 3 of them, labels at most 16 characters, which needs //@composer; pressing it sends the 'input' event with the id and the text typed, and a text answered replaces the input's text. A button with one item and no composer field or page runs it on a press, with no menu. Use it to rewrite, translate or draft what the user is about to send.
- //@menu <id> <label>: an item in the chat's ⋯ menu; pressing it sends the 'menu' event with the id.
- //@action <id> <label>: an item in each message's ⋯, at most 3 of them, labels at most 16 characters; pressing it sends the 'action' event with the id.
- //@page <label>: the plugin's own page. The same file also runs there, with hazelle.context === 'page' and the page's own document.
Ids use letters, numbers, _, . or -. Every label the user reads is Korean.

The file runs in a sandboxed iframe with no access to the app's page; hazelle.context is 'background' there. Register handlers with hazelle.on at the top level. The browser's fetch and XMLHttpRequest are blocked; use chat.fetch with //@uses network. Use only what the API below declares.

Answer with a short Korean note (1–2 sentences, 해요체), then the whole file in one \`\`\`js block. Never a patch or part of the file. If the API cannot do what is asked, say so in the note and send no code block.

Example:
\`\`\`js
//@setting {"key":"unit","label":"단위","type":"text","default":"자"}

hazelle.on('reply', async (chat, reply) => {
  const [message] = await chat.messages(reply.index, reply.index + 1);
  const { unit } = await hazelle.settings();
  if (message) chat.badge(reply.index, \`\${message.text.replace(/\\s/g, '').length}\${unit}\`);
});
\`\`\`

API:
`;

// body: the draft's file without its identity lines; null for a new file. runs: the test runs the run_test tool allows,
// 0 where it is not offered.
export function pluginAskMessages(api: string, body: string | null, ask: string, runs = 0): ChatMessage[] {
  const file = body === null ? 'The file is new. Begin it with //@display-name <a short Korean name> and //@description <one Korean sentence>.' : `The current file, without the identity lines the app keeps:\n${body}`;
  const testing = runs ? `\n\nBefore you answer, run the whole new file with run_test at the moments the change touches, and fix what it reports. At most ${runs} runs. Then answer as the rules say: the short Korean note in 해요체, even though the test reports are in English, then the whole file.` : '';
  return [
    { role: 'system', content: RULES + api },
    { role: 'user', content: `${file}${testing}\n\nRequest:\n${ask}` },
  ];
}

// proposed: the name and description a new file's answer begins with; the app takes them only for a new draft.
export type PluginAnswer = { ok: true; note: string; body: string; proposed: Partial<Pick<ToolIdentity, 'displayName' | 'description'>> } | { ok: false; note: string };

export function readPluginAnswer(text: string): PluginAnswer {
  const blocks = [...text.matchAll(/^```(?:js|javascript)?[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  const last = blocks.at(-1);
  if (!last) return { ok: false, note: text.trim() };
  const { identity, body } = splitTool(last[1]!);
  return { ok: true, note: text.slice(0, last.index).trim(), body, proposed: { ...(identity.displayName && { displayName: identity.displayName }), ...(identity.description && { description: identity.description }) } };
}
