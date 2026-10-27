import type { RisuScan, ToolField, ToolManifest } from '../../tool-api/manifest';
import { RISU_MAPPED, RISU_NAMES, RISU_REPLACERS } from '../../tool-api/risu-methods';
import { failed, identity, readTool, toolText, type HeaderLine, type ToolRead } from './tool';

// Fixed author preserves Risu plugin identity and tool variables across reimports; Risu headers have no author.
export const RISU_AUTHOR = 'risu';
const RISU_ONLY = new Set(['arg', 'link', 'update-url']);

// Distinguish Hazelle tools by //@author. Risu //@api may list multiple versions; missing api is legacy, not Hazelle.
export function readToolFile(bytes: Uint8Array<ArrayBuffer>): ToolRead {
  const text = toolText(bytes);
  if (!text.ok) return text;
  const has = (key: string) => text.header.some((line) => line.key === key);
  const api = text.header.findLast((line) => line.key === 'api')?.value.split(/\s+/);
  if (api?.some((version) => /^3(\.\d+)?$/.test(version))) return readRisuPlugin(text.header, text.body, bytes);
  const old = api ? api.some((version) => /^2(\.\d+)?$/.test(version)) : text.header.some((line) => RISU_ONLY.has(line.key)) || (has('name') && !has('author'));
  return old ? failed('risu-old') : readTool(bytes);
}

const ARG_META = /\{\{([\w-]+)::(.*?)\}\}/g;

// //@update-url is left unread on purpose: a tool updates through Hazelle only (design §6.10).
function readRisuPlugin(header: HeaderLine[], body: string, bytes: Uint8Array<ArrayBuffer>): ToolRead {
  const last = (key: string) => header.findLast((line) => line.key === key)?.value;
  // Risu takes any name, spaces included (Asset Maid); only Hazelle's own tools keep to identity().
  const name = last('name')?.trim() ?? '';
  if (!name) return failed('risu-name');
  const settings: ToolField[] = [];
  for (const { key, value, written } of header) {
    if (key !== 'arg') continue;
    const arg = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(value);
    if (!arg || !identity(arg[1]!) || (arg[2] !== 'string' && arg[2] !== 'int') || settings.some((field) => field.key === arg[1])) return failed('tool-setting', written);
    // An arg's text may carry Risu's {{key::value}} metadata; {{name::…}} is its label.
    const text = arg[3] ?? '';
    const named = [...text.matchAll(ARG_META)].find((meta) => meta[1] === 'name')?.[2]?.trim();
    settings.push({ key: arg[1]!, type: arg[2] === 'int' ? 'number' : 'text', label: named || text.replace(ARG_META, '').trim() || arg[1]! });
  }
  const about = header.flatMap(({ key, value }) => {
    if (key === 'description') return value ? [value] : [];
    if (key !== 'link') return [];
    const [url, ...label] = value.split(/\s+/);
    return url ? [[label.join(' '), url].filter(Boolean).join(' ')] : [];
  });
  const risu = scanRisu(body);
  // A literal host is the network too: a picture or font the frame loads from it reaches the outside (static.ts).
  const network = /\b(?:nativeFetch|risuFetch)\b/.test(body) || risu.hosts.length > 0;
  const manifest: ToolManifest = {
    api: 1, name, author: RISU_AUTHOR, displayName: last('display-name') || name, version: last('version') ?? '', description: about.join('\n'),
    uses: [...(/\b(?:runLLMModel|sendChat)\b/.test(body) ? ['model' as const] : []), ...(network ? ['network' as const] : [])], page: null, menu: [], settings, actions: [], composer: null, risu,
  };
  return { ok: true, tool: { manifest, bytes } };
}

const QUOTED = /\s*(?:\?\.)?\[\s*(['"`])([A-Za-z_$][\w$]*)\1\s*\]/y;
const DOTTED = /\s*\??\.\s*([A-Za-z_$][\w$]*)/y;
const REPLACER_KIND = /\s*(?:\?\.)?\(\s*(['"`])([\w-]*)\1/y;
const sticky = (pattern: RegExp, text: string, from: number) => {
  pattern.lastIndex = from;
  return pattern.exec(text);
};

const UNMAPPED_ANYWHERE = new RegExp(`(?:\\.|\\[\\s*['"\`])\\s*(${RISU_NAMES.filter((name) => !RISU_MAPPED.has(name)).join('|')})\\b`, 'g');
const REPLACER_ANYWHERE = /\.\s*addRisuReplacer\s*(?:\?\.)?\(\s*(['"`])([\w-]*)\1/g;

// Only literal member access is exhaustively scannable; aliases/destructuring/globalThis make verdict unread.
// Bare quoted risuai is a model name, not API use. Blank URLs first so risuai.xyz is not mistaken for a member.
export function scanRisu(body: string): RisuScan {
  const missing = new Set<string>();
  let unread = false;
  const code = body.replace(/https?:\/\/[^\s'"`]*/g, (url) => ' '.repeat(url.length));
  for (const found of code.matchAll(/\b[Rr]isuai\b/g)) {
    const end = found.index + found[0].length;
    if (/['"`]/.test(code[found.index - 1] ?? '') || /['"`]/.test(code[end] ?? '')) continue;
    const member = /\.\s*$/.test(code.slice(Math.max(0, found.index - 8), found.index)) ? null : (sticky(DOTTED, code, end) ?? sticky(QUOTED, code, end));
    if (!member) {
      unread = true;
      continue;
    }
    const name = member[member.length - 1]!;
    if (!RISU_MAPPED.has(name)) missing.add(name);
    if (name !== 'addRisuReplacer') continue;
    const kind = sticky(REPLACER_KIND, code, end + member[0].length);
    if (!kind) unread = true;
    else if (!RISU_REPLACERS.has(kind[2]!)) missing.add(`addRisuReplacer:${kind[2]}`);
  }
  if (unread) {
    for (const found of code.matchAll(UNMAPPED_ANYWHERE)) missing.add(found[1]!);
    for (const found of code.matchAll(REPLACER_ANYWHERE)) if (!RISU_REPLACERS.has(found[2]!)) missing.add(`addRisuReplacer:${found[2]}`);
  }
  const hosts = new Set([...body.matchAll(/https?:\/\/([\w-]+(?:\.[\w-]+)*)(?![\w-]|\.[\w-]|\.?\$)/gi)].map((url) => url[1]!.toLowerCase()));
  return { verdict: unread ? 'unread' : missing.size > 0 ? 'partial' : 'all', missing: [...missing], hosts: [...hosts] };
}
