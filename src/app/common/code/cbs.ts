import { blockHead, blockNames, conditionSteps, isBlockName, isProse, isRawBlock, separatorOf, whenArgs } from '../../../engine/cbs/evaluate';
import { parse, type Block, type Legacy, type Node, type Tag } from '../../../engine/cbs/parse';
import { handlerFor, isUnsupportedTag, normalize } from '../../../engine/cbs/tags';
import { nearest } from '../../../engine/edit-distance';
import type { CodeCompletion, CodeDoc, CodeItem, CodeLanguage, CodeProblem, CodeSpan } from '../../ui';
import { particleOf, withParticle } from '../particles';
import { COMMANDS, type Command } from './cbsCommands';
import { variableDoc, variableItems, type Variables } from './variables';

// Text one field puts in before CBS runs: a card's instructions take {{original}} (pipeline.ts), a regex's
// replacement {{data}} (regex/scripts.ts). Both replace only the exact spelling.
type CbsPlaceholder = 'original' | 'data';
const PLACEHOLDERS: Record<CbsPlaceholder, string> = {
  original: '이 칸이 대체하는 기본 프롬프트 텍스트가 이 자리에 들어가요.',
  data: '패턴이 찾은 텍스트 전체가 그 자리에 들어가요.',
};

const headOf = (form: string) => /^\{\{([#/]?[^:}\s]+|:)/.exec(form)![1]!;
const ENTRIES = COMMANDS.flatMap((group) => group.commands.map((command) => ({ command, group: group.title, head: headOf(command.form) })));
// By normalized name; a block by its head, `#when`.
const BY_NAME = new Map<string, Command>();
for (const { command, head } of ENTRIES) for (const name of command.names.length ? command.names : [head]) BY_NAME.set(head.startsWith('#') ? head : normalize(name), command);
// The evaluator reads `{{? 1+1}}` as calc.
BY_NAME.set('?', BY_NAME.get('calc')!);
const known = (name: string) => handlerFor(name) !== undefined || BY_NAME.has(normalize(name));
// The names a typo is matched against, as written and as compared.
const pool = (names: string[]) => names.map((name) => ({ name, key: normalize(name) }));
const TAG_POOL = pool(ENTRIES.flatMap(({ command, head }) => (command.names.length ? command.names : head.startsWith('#') ? [] : [head])));
const BLOCK_POOL = pool(blockNames());
const WRITERS = new Set(['setvar', 'addvar', 'setdefaultvar']);
const VARIABLE_TAGS = new Set(['getvar', ...WRITERS]);
const VARIABLE_SLOT = new RegExp(`\\{\\{\\s*(?:${[...VARIABLE_TAGS].join('|')})::([^:{}]*)$`, 'i');

// A form's words become tab stops: `{{getvar::이름}}` → `getvar::${1:이름}}}${0}`, written after the `{{` typed.
export function formTemplate(form: string) {
  let stop = 0;
  const field = (word: string) => `\${${++stop}:${word.replace(/[{}]/g, '')}}`;
  const body = form.replace(/\{\{([^{}]*)\}\}|([^{}]+)/g, (_, tag: string | undefined, text: string | undefined) => {
    if (tag === undefined) return field(text!);
    const [head, ...args] = tag.split('::');
    const space = head!.indexOf(' ');
    const name = space < 0 ? head : `${head!.slice(0, space)} ${field(head!.slice(space + 1))}`;
    return `{{${[name, ...args.map(field)].join('::')}}}`;
  });
  return `${body.slice(2)}\${0}`;
}

function commandDoc(command: Command): CodeDoc {
  const facts: [string, string][] = [];
  if (command.example) facts.push(['예', `${command.example[0]} → ${command.example[1]}`]);
  if (command.names.length > 1) facts.push(['다른 이름', command.names.slice(1).join(', ')]);
  return { form: command.form, text: command.what, facts };
}

// A tag as written. name: as written and trimmed, from nameAt; null when a tag inside it makes it. value: where its
// first argument stands.
type Found = { from: number; to: number; name: string | null; nameAt: number; value: { from: number; to: number } | null };
type Reading = { spans: CodeSpan[]; problems: CodeProblem[]; tags: Found[] };

// The text of a tag with no tag inside it.
const plain = (node: Tag) => (node.parts.length === 1 && typeof node.parts[0] === 'string' ? node.parts[0] : null);

// Where a tag's name ends in its leading text, rest being that text past its spaces; -1 when a tag inside it makes the name.
function nameLength(lead: string, rest: string, whole: boolean) {
  const mark = /^[#/][^\s:]*/.exec(rest);
  if (mark) return mark[0].length;
  if (/^:(else)?\s*$/.test(rest)) return rest.trimEnd().length;
  // As the evaluator reads it: only at the very start.
  if (lead.startsWith('? ')) return 1;
  const colon = rest.indexOf(':');
  if (colon !== -1) return colon;
  return whole ? rest.trimEnd().length : -1;
}

function read(text: string, placeholder: CbsPlaceholder | undefined): Reading {
  const spans: CodeSpan[] = [];
  const problems: CodeProblem[] = [];
  const tags: Found[] = [];
  const span = (from: number, to: number, kind: CodeSpan['kind']) => {
    if (to > from) spans.push({ from, to, kind });
  };
  const problem = (from: number, to: number, severity: CodeProblem['severity'], message: string, fix?: CodeProblem['fix']) => problems.push({ from, to, severity, message, ...(fix && { fix }) });

  // The nodes on one level, from at; block: the name of the block they are the body of.
  const level = (nodes: Node[], at: number, block: string | null) => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        // Only an unclosed `{{` is left in text: parse reads every other one as a tag.
        for (let found = node.indexOf('{{'); found !== -1; found = node.indexOf('{{', found + 2)) problem(at + found, at + found + 2, 'warning', '짝이 되는 }}가 없어서 글자 그대로 들어가요.');
        at += node.length;
      } else {
        visit(node, block);
        at = node.end;
      }
    }
  };

  const visit = (node: Exclude<Node, string>, block: string | null) => {
    if (node.kind === 'legacy') return legacy(node);
    if (node.kind === 'block') return blockOf(node);
    const found = tag(node);
    if (!found?.name) return;
    const { name } = found;
    const word = normalize(name);
    if (name.startsWith('#')) problem(node.at, node.end, 'error', `블록을 닫는 {{/${name.slice(1)}}} 태그가 없어요.`);
    else if (name.startsWith('/')) problem(node.at, node.end, 'error', '열린 블록 없이 닫는 태그예요.');
    else if (name === ':else') {
      if (block !== 'when') problem(node.at, node.end, 'warning', '{{:else}}는 #when 블록 안에서만 써요.');
    } else if (placeholder && word === placeholder) {
      const exact = `{{${placeholder}}}`;
      if (text.slice(node.at, node.end) !== exact) problem(node.at, node.end, 'warning', `${exact} 그대로 적어야 바뀌어요.`, { label: `${exact}${particleOf(placeholder, '으로/로')} 바꾸기`, insert: exact });
    } else if (known(name)) return;
    else if (isUnsupportedTag(word)) problem(node.at, node.end, 'warning', '헤이젤에서 지원하지 않는 명령어라 입력한 그대로 남아요.');
    else if (!isProse(word)) unknown(name, found, TAG_POOL);
  };

  const unknown = (name: string, { nameAt }: Found, names: typeof TAG_POOL) => {
    const near = nearest(normalize(name.replace(/^#/, '')), names, ({ key }) => key, 2)?.name;
    const at = name.startsWith('#') ? nameAt + 1 : nameAt;
    const to = nameAt + name.length;
    if (near) problem(at, to, 'warning', `${near}의 오타 같아요.`, { label: `${withParticle(near, '으로/로')} 바꾸기`, insert: near });
    else problem(at, to, 'warning', '알 수 없는 명령어라 입력한 그대로 남아요.');
  };

  const blockOf = (node: Block) => {
    const head = tag(node.head);
    const written = head?.name ? head.name.slice(1) : null;
    const name = written === null ? null : normalize(written);
    if (head && name !== null) {
      if (!isBlockName(name) && !isProse(name)) unknown(head.name!, head, BLOCK_POOL);
      const whole = plain(node.head);
      if (name === 'when' && whole !== null) {
        const { condition } = whenArgs(blockHead(whole)!.rest);
        if (condition.length === 0 || !conditionSteps(condition).valid) problem(node.head.at, node.head.end, 'warning', '조건식이 올바르지 않아 항상 거짓({{:else}}) 쪽 텍스트가 들어가요.');
      }
    }
    // A raw block's body is text, whatever it holds.
    if (name === null || !isRawBlock(name)) level(node.body, node.head.end, name);
    const shut = tag(node.close)?.name?.slice(1);
    if (written !== null && shut && normalize(shut) !== name) {
      problem(node.close.at, node.close.end, 'warning', `#${written} 블록을 닫는 태그예요.`, { label: `/${written}${particleOf(written, '으로/로')} 바꾸기`, insert: `{{/${written}}}` });
    }
  };

  const legacy = (node: Legacy) => {
    span(node.at, node.at + 2, 'tag');
    parts(node.parts, node.at + 2, '::');
    span(node.end - 2, node.end, 'tag');
  };

  // The tag's spans and what it is; null for a comment.
  const tag = (node: Tag): Found | null => {
    const lead = typeof node.parts[0] === 'string' ? node.parts[0] : '';
    if (lead.startsWith('//')) {
      span(node.at, node.end, 'comment');
      return null;
    }
    const whole = plain(node) !== null;
    if (whole && lead === 'slot') {
      span(node.at, node.end, 'slot');
      const found: Found = { from: node.at, to: node.end, name: 'slot', nameAt: node.at + 2, value: null };
      tags.push(found);
      return found;
    }
    const rest = lead.trimStart();
    const skip = lead.length - rest.length;
    const length = nameLength(lead, rest, whole);
    const partial = length === -1 || (skip + length === lead.length && node.parts.length > 1);
    const after = partial ? node.at + 2 : node.at + 2 + skip + length;
    const found: Found = { from: node.at, to: node.end, name: partial ? null : rest.slice(0, length).trimEnd(), nameAt: node.at + 2 + skip, value: null };
    tags.push(found);
    span(node.at, after, 'tag');
    found.value = parts(partial ? node.parts : [lead.slice(skip + length), ...node.parts.slice(1)], after, separatorOf(lead) ?? '::');
    span(node.end - 2, node.end, 'tag');
    return found;
  };

  // A tag's parts after its name: separators, arguments and the tags inside. Gives where its first argument stands.
  const parts = (nodes: Node[], at: number, separator: string) => {
    let value: { from: number; to: number } | null = null;
    let open: number | null = null;
    for (const node of nodes) {
      if (typeof node !== 'string') {
        visit(node, null);
        at = node.end;
        continue;
      }
      let from = 0;
      for (let cut = node.indexOf(separator); ; cut = node.indexOf(separator, cut + separator.length)) {
        const to = cut === -1 ? node.length : cut;
        span(at + from, at + to, 'argument');
        if (open !== null && value === null && cut !== -1) value = { from: open, to: at + to };
        if (cut === -1) break;
        span(at + cut, at + cut + separator.length, 'separator');
        if (open === null) open = at + cut + separator.length;
        from = cut + separator.length;
      }
      at += node.length;
    }
    return value ?? (open === null ? null : { from: open, to: at });
  };

  level(parse(text), 0, null);
  return { spans: spans.sort((a, b) => a.from - b.from), problems, tags };
}

// The innermost block still open where a `{{/` is typed, as written: parse reads an unclosed block's head as a lone
// tag at the top, in order.
function openBlock(before: string): string | null {
  const heads = parse(before).filter((node): node is Tag => typeof node !== 'string' && node.kind === 'tag' && typeof node.parts[0] === 'string' && node.parts[0].trimStart().startsWith('#'));
  const head = heads.at(-1)?.parts[0] as string | undefined;
  return head === undefined ? null : /^#([^\s:]*)/.exec(head.trimStart())![1]! || null;
}

const NO_VARIABLES: Variables = { defaults: [], chat: null };

// variables: offered and explained by name. placeholder: the field's own, when it has one.
export function cbsLanguage({ variables = NO_VARIABLES, placeholder }: { variables?: Variables; placeholder?: CbsPlaceholder } = {}): CodeLanguage {
  let last: { text: string; reading: Reading } | null = null;
  const reading = (text: string) => (last?.text === text ? last.reading : (last = { text, reading: read(text, placeholder) }).reading);
  const own = placeholder && { name: placeholder, doc: { form: `{{${placeholder}}}`, text: PLACEHOLDERS[placeholder] } };
  // The names the text's setters write, but the one being typed at at.
  const written = (text: string, at: number) =>
    reading(text).tags.flatMap(({ name, value }) => (name && WRITERS.has(normalize(name)) && value && !(value.from <= at && at <= value.to) ? [text.slice(value.from, value.to)] : [])).filter((name) => name && !name.includes('{{'));
  const items: CodeItem[] = [
    ...ENTRIES.map(({ command, group, head }): CodeItem => ({ label: head, kind: head.startsWith('#') ? 'keyword' : 'function', detail: group, template: formTemplate(command.form), ...(command.uses && { boost: 1 }), doc: commandDoc(command) })),
    ...(own ? [{ label: own.name, kind: 'variable', detail: '이 칸', template: `${own.name}}}\${0}`, boost: 2, doc: own.doc } satisfies CodeItem] : []),
  ];

  const complete = (text: string, at: number): CodeCompletion | null => {
    const before = text.slice(0, at);
    const slot = VARIABLE_SLOT.exec(before);
    if (slot) {
      return { from: at - slot[1]!.length, items: variableItems(variables, written(text, at)), validFor: /^[^:{}]*$/ };
    }
    const word = /\{\{([#/]?[\w가-힣?-]*)$/.exec(before);
    if (!word) return null;
    const from = at - word[1]!.length;
    const block = word[1]!.startsWith('/') ? openBlock(text.slice(0, from - 2)) : null;
    const close: CodeItem[] = block ? [{ label: `/${block}`, kind: 'keyword', detail: `#${block} 닫기`, template: `/${block}}}\${0}`, boost: 99 }] : [];
    return { from, items: [...close, ...items], validFor: /^[#/]?[\w가-힣?-]*$/, closing: '}}' };
  };

  const explain = (text: string, at: number) => {
    const found = reading(text).tags.findLast((tag) => tag.from <= at && at <= tag.to);
    if (!found?.name) return null;
    const word = normalize(found.name);
    if (VARIABLE_TAGS.has(word) && found.value && found.value.from <= at && at <= found.value.to) {
      const name = text.slice(found.value.from, found.value.to);
      return name.includes('{{') ? null : { from: found.from, to: found.to, doc: variableDoc(name, variables) };
    }
    if (own && word === own.name) return { from: found.from, to: found.to, doc: own.doc };
    const command = found.name.startsWith('#') || found.name.startsWith('/') ? BY_NAME.get(`#${normalize(found.name.slice(1))}`) : BY_NAME.get(word);
    return command ? { from: found.from, to: found.to, doc: commandDoc(command) } : null;
  };

  return {
    syntax: (text) => reading(text).spans,
    comment: { open: '{{// ', close: '}}' },
    lint: (text) => reading(text).problems,
    complete,
    explain,
  };
}
