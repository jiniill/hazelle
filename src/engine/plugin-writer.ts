import type { ChatMessage } from '../connectors/types';
import type { ToolIdentity } from '../model/tool';
import { splitTool } from './import/tool';

// The rules and the API come first and never change, so the provider can cache them; the file and the ask follow.
const RULES = `You write Hazelle plugins inside the app's plugin studio.

The app writes the file's identity lines itself: //@api, //@name, //@author, //@version, //@display-name and //@description. Never write them, even though the guide's examples do, except //@display-name and //@description when the request says the file is new.

Answer with a short Korean note (1–2 sentences, 해요체), then the whole file in one \`\`\`js block. Never a patch or part of the file. If the API cannot do what is asked, say so in the note and send no code block.

The plugin guide and the API follow. The guide's sections on Claude Code and on checking and installing are for authors outside the app.

`;

// body: the draft's file without its identity lines; null for a new file. earlier: the draft's last asks with their notes,
// oldest first. runs: the test runs the run_test tool allows, 0 where it is not offered.
export function pluginAskMessages(reference: string, body: string | null, ask: string, earlier: { ask: string; note: string }[] = [], runs = 0): ChatMessage[] {
  const file = body === null ? 'The file is new. Begin it with //@display-name <a short Korean name> and //@description <one Korean sentence>.' : `The current file, without the identity lines the app keeps:\n${body}`;
  const before = earlier.length ? '\n\nThe asks above came before this one. Each change was applied or discarded; the current file shows which.' : '';
  const testing = runs ? `\n\nBefore you answer, run the whole new file with run_test, listing every moment the change touches in the order a user reaches them, and fix what it reports. At most ${runs} runs. Then answer as the rules say: the short Korean note in 해요체, even though the test reports are in English, then the whole file.` : '';
  return [
    { role: 'system', content: RULES + reference },
    ...earlier.flatMap(({ ask, note }): ChatMessage[] => [{ role: 'user', content: `Request:\n${ask}` }, { role: 'assistant', content: note }]),
    { role: 'user', content: `${file}${before}${testing}\n\nRequest:\n${ask}` },
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
