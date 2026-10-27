import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Copy-only extract/apply pipeline: template literals are split into nonoverlapping literal runs;
// numbered text/untext batches let models rewrite sentences without source code.

export type Entry = {
  id: string;
  kind: 'string' | 'template' | 'jsx' | 'html';
  owner: string;
  context: string;
  text: string;
  span: [number, number];
  // A template's literal runs, between its ${…}: only these are rewritten, so a string nested in an expression stays
  // an entry of its own and the two never overlap.
  parts?: [number, number][];
};
// What extract writes: a span is only good for the source it was read from, so apply finds each entry again.
export type Listed = Omit<Entry, 'span' | 'parts'>;
export type Source = { path: string; source: string };

const KOREAN = /[ㄱ-ㆎ가-힣]/;
const SOURCES = ['src/**/*.ts', 'src/**/*.tsx'];
const PAGES = ['index.html', 'sandbox.html', 'public/site.webmanifest'];
// A prompt the model reads, and code shipped as a string, are not copy: INLAY_EXPORT's two alerts are edited by hand.
const NOT_COPY = new Set(['INSTRUCTIONS', 'INLAY_EXPORT']);
const HTML_TEXT = /(?<=>)[^<>]+(?=<)|(?<=")[^"\n<>]+(?=")/g;

function lineOf(source: string, at: number) {
  const start = source.lastIndexOf('\n', at - 1) + 1;
  const end = source.indexOf('\n', at);
  return { line: source.slice(0, at).split('\n').length, text: source.slice(start, end < 0 ? undefined : end).trim().slice(0, 240) };
}

function ownerOf(node: ts.Node): string {
  const names: string[] = [];
  for (let at = node.parent; at; at = at.parent) {
    if ((ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at) || ts.isPropertyAssignment(at) || ts.isMethodDeclaration(at) || ts.isJsxAttribute(at)) && at.name) {
      names.unshift(at.name.getText());
    }
  }
  return names.join(' › ');
}

// Types and keys are matched against, not shown.
function isMatched(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node);
}

function codeEntries({ path, source }: Source): Entry[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const entries: Entry[] = [];
  const add = (node: ts.Node, kind: Entry['kind'], span: [number, number], parts?: [number, number][]) => {
    const owner = ownerOf(node);
    if (NOT_COPY.has(owner.split(' › ')[0]!)) return;
    const { line, text } = lineOf(source, span[0]);
    entries.push({ id: `${path}:${line}:${span[0]}`, kind, owner, context: text, text: source.slice(...span), span, ...(parts && { parts }) });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && KOREAN.test(node.text) && !isMatched(node)) {
      add(node, ts.isStringLiteral(node) ? 'string' : 'template', [node.getStart() + 1, node.end - 1], ts.isStringLiteral(node) ? undefined : [[node.getStart() + 1, node.end - 1]]);
    } else if (ts.isTemplateExpression(node)) {
      const literals = [node.head, ...node.templateSpans.map((span) => span.literal)];
      if (literals.some((literal) => KOREAN.test(literal.text))) {
        add(node, 'template', [node.getStart() + 1, node.end - 1], literals.map((literal) => [literal.getStart() + 1, literal.end - (ts.isTemplateTail(literal) ? 1 : 2)]));
      }
    } else if (ts.isJsxText(node) && KOREAN.test(node.text)) {
      const raw = node.getText();
      const start = node.getStart() + raw.length - raw.trimStart().length;
      add(node, 'jsx', [start, start + raw.trim().length]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return entries;
}

function pageEntries({ path, source }: Source): Entry[] {
  return [...source.matchAll(HTML_TEXT)]
    .filter((match) => KOREAN.test(match[0]))
    .map((match) => {
      const { line, text } = lineOf(source, match.index);
      return { id: `${path}:${line}:${match.index}`, kind: 'html', owner: '', context: text, text: match[0], span: [match.index, match.index + match[0].length] };
    });
}

export function extract(sources: readonly Source[]): Entry[] {
  return sources.flatMap((source) => (/\.tsx?$/.test(source.path) ? codeEntries(source) : pageEntries(source)));
}

function parseTemplate(inner: string) {
  const file = ts.createSourceFile('x.ts', `(\`${inner}\`)`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  const expression = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : null;
  if (expression && ts.isNoSubstitutionTemplateLiteral(expression) && expression.getText() === `\`${inner}\``) return { literals: [inner], expressions: [] };
  if (!expression || !ts.isTemplateExpression(expression) || expression.getText() !== `\`${inner}\``) return null;
  const literals = [expression.head, ...expression.templateSpans.map((span) => span.literal)];
  return { literals: literals.map((literal) => literal.getText().slice(1, ts.isTemplateTail(literal) ? -1 : -2)), expressions: expression.templateSpans.map((span) => span.expression.getText()) };
}

function isOneString(inner: string, quote: string) {
  const file = ts.createSourceFile('x.ts', `(${quote}${inner}${quote})`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  const expression = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : null;
  return !!expression && ts.isStringLiteral(expression) && expression.getText() === `${quote}${inner}${quote}`;
}

type Edit = { start: number; end: number; text: string };

function editsFor(entry: Entry, text: string, source: string): Edit[] | string {
  if (entry.kind === 'template') {
    const before = parseTemplate(entry.text);
    const after = parseTemplate(text);
    if (!after || !before || after.expressions.join('\0') !== before.expressions.join('\0')) return 'the ${…} expressions changed';
    return entry.parts!.map(([start, end], index) => ({ start, end, text: after.literals[index]! }));
  }
  if (entry.kind === 'string' && !isOneString(text, source[entry.span[0] - 1]!)) return 'not one string literal in its quotes';
  if (entry.kind === 'jsx' && /[{}<>]/.test(text)) return 'JSX text cannot hold { } < >';
  if (entry.kind === 'html' && /[<>"\n]/.test(text)) return 'page text cannot hold < > " or a line break';
  return [{ start: entry.span[0], end: entry.span[1], text }];
}

const pathOf = (id: string) => id.slice(0, id.indexOf(':'));

// Re-find entries by text/occurrence, never stale offsets; unrelated source edits must not shift replacements.
function keyed(entries: readonly Listed[]) {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const key = [pathOf(entry.id), entry.kind, entry.owner, entry.text].join('\0');
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return [`${key}\0${nth}`, entry] as const;
  });
}

export function apply(sources: readonly Source[], original: readonly Listed[], revised: readonly Pick<Entry, 'id' | 'text'>[]) {
  const current = new Map(keyed(extract(sources)));
  const byId = new Map(keyed(original).map(([key, entry]) => [entry.id, { entry, now: current.get(key) as Entry | undefined }]));
  const rejected: { id: string; reason: string }[] = [];
  const edits = new Map<string, Edit[]>();
  for (const { id, text } of revised) {
    const found = byId.get(id);
    if (!found) rejected.push({ id, reason: 'no such entry' });
    else if (found.entry.text === text) continue;
    else if (!found.now) rejected.push({ id, reason: 'the source changed since extract' });
    else {
      const path = pathOf(id);
      const result = editsFor(found.now, text, sources.find((each) => each.path === path)!.source);
      if (typeof result === 'string') rejected.push({ id, reason: result });
      else edits.set(path, [...(edits.get(path) ?? []), ...result]);
    }
  }
  const written = [...edits].map(([path, list]) => {
    let source = sources.find((each) => each.path === path)!.source;
    for (const edit of list.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return { path, source };
  });
  return { written, rejected };
}

// Give models numbered sentences only: source context encouraged invention.
// Use [N] to avoid Markdown auto-renumbering; numbers retain extract-list indices and ${…} becomes {1}, {2}… .
const SYNTAX_OWNER = /(?:^|› )(?:form|example|written|result|card|name|variables|toggle|SAMPLE_NOTE)$/;
const BATCH_LINES = 150;
const ROLE: [RegExp, string][] = [
  [/(?:help|hint|HELP)$/, '(설명) '],
  [/(?:title|heading)$/, '(제목) '],
];
const PREAMBLE = `Rewrite each numbered Korean line below so it is easier to read and understand. Keep exactly the same meaning and the same information: add nothing, drop nothing.

Answer inside one \`\`\`text code block, with every line, changed or not, as \`[N] text\`, in the same order, and nothing else in the block: no headings, no notes. Keep each [N] exactly as given; never merge, split or renumber lines.

- {1}, {2}… mark where something is inserted (a name, a number, another phrase). Keep each one, in the same order.
- A line marked (설명) is help text and (제목) a title; do not copy the mark into your answer. Lines under one ## heading sit on the same screen.
- Voice: short 해요체, the way Toss writes. Plain, specific words. It must not read as AI-written.
- Keep names (헤이젤, RisuAI, Risu, model and company names), {{…}} syntax, and a path written as A › B.
- Keep these words as they are: 대화 모델, 보조 모델, 임베딩 모델, 삭제, 이미지, 응답, 선택, 복원, 기본값, 공용, 원래 값, 키, 키워드, 내보내기, 가져오기, 스크립트, 챕터, 캐릭터 없이, 채팅 파일. These pairs mean different things and are never swapped: 빼기/삭제, 편집/수정, 다시 생성/다시 시도, 컨텍스트 길이/컨텍스트 한도, 사용 중/생성 중.
- Never use: 지우기, 지웠어요, 고치기, 고르기, 골라 주세요, 답장, 그림, 되살리기, 처음 값, 불러오기, 내려받기, 프로바이더, 금고, 열쇠, 복제, ‘ ’.
`;

function isSentence(entry: Listed): boolean {
  if (/^src\/app\/common\/(legal|release)\.ts:/.test(entry.id)) return false;
  if (/^src\/app\/prompts\/(commands|guides)\.ts:/.test(entry.id) && SYNTAX_OWNER.test(entry.owner)) return false;
  const line = shownLine(entry);
  if (!line || line.includes('\n')) return false;
  const words = line.replace(/(?:\s*\{\d+\})+$/, '');
  return words.includes(' ') && /[.?!…요]$/.test(words);
}

// Edge spaces join a piece to the sentence around it; they are kept off the line and put back.
const edges = (text: string) => [text.match(/^\s*/)![0], text.match(/\s*$/)![0]] as const;

function shownLine(entry: Listed): string | null {
  return untrimmed(entry)?.trim() ?? null;
}

function untrimmed(entry: Listed): string | null {
  if (entry.kind === 'jsx') return entry.text.replace(/\s*\n\s*/g, ' ');
  if (entry.kind === 'string') return entry.text.replace(/\\(['"])/g, '$1');
  if (entry.kind === 'html') return entry.text;
  const template = parseTemplate(entry.text);
  return template && template.literals.map((literal, index) => (index ? `{${index}}${literal}` : literal)).join('');
}

function fromLine(entry: Listed, line: string): string | { reason: string } {
  const [lead, trail] = edges(entry.text);
  const text = sourceOf(entry, line);
  return typeof text === 'string' ? `${lead}${text}${trail}` : text;
}

function sourceOf(entry: Listed, line: string): string | { reason: string } {
  if (entry.kind === 'string') {
    let text = line;
    if (entry.text.includes("\\'")) text = text.replace(/(?<!\\)'/g, "\\'");
    if (entry.text.includes('\\"')) text = text.replace(/(?<!\\)"/g, '\\"');
    return text;
  }
  if (entry.kind !== 'template') return line;
  const { expressions } = parseTemplate(entry.text)!;
  const pieces = line.split(/\{(\d+)\}/);
  const slots = pieces.filter((_, index) => index % 2).map(Number);
  if (slots.join() !== expressions.map((_, index) => index + 1).join()) return { reason: 'the {n} slots changed' };
  return pieces.map((piece, index) => (index % 2 ? `\${${expressions[Number(piece) - 1]}}` : piece)).join('');
}

export function toText(list: readonly Listed[]): { name: string; body: string }[] {
  const areas = new Map<string, number[]>();
  list.forEach((entry, index) => {
    if (!isSentence(entry)) return;
    const [top, layer, folder, file] = pathOf(entry.id).split('/');
    const area = top !== 'src' ? 'pages' : layer !== 'app' ? layer! : file ? `app-${folder}` : 'app';
    areas.set(area, [...(areas.get(area) ?? []), index]);
  });
  const batches: { name: string; body: string }[] = [];
  for (const [area, indexes] of areas) {
    const size = Math.ceil(indexes.length / Math.ceil(indexes.length / BATCH_LINES));
    const chunks: number[][] = [[]];
    for (const index of indexes) {
      const chunk = chunks.at(-1)!;
      const last = chunk.at(-1);
      if (chunk.length >= size && last !== undefined && pathOf(list[last]!.id) !== pathOf(list[index]!.id)) chunks.push([index]);
      else chunk.push(index);
    }
    chunks.forEach((chunk, part) => {
      let heading = '';
      const lines = chunk.flatMap((index) => {
        const entry = list[index]!;
        const file = pathOf(entry.id).replace(/^src\/(app\/)?/, '');
        const role = ROLE.find(([owner]) => owner.test(entry.owner))?.[1] ?? '';
        const line = `[${index + 1}] ${role}${shownLine(entry)}`;
        if (file === heading) return [line];
        heading = file;
        return ['', `## ${file}`, line];
      });
      const name = `${String(batches.length + 1).padStart(2, '0')}-${area}${chunks.length > 1 ? `-${part + 1}` : ''}.txt`;
      batches.push({ name, body: `${PREAMBLE}${lines.join('\n')}\n` });
    });
  }
  return batches;
}

export function fromText(list: readonly Listed[], answers: readonly string[]) {
  const revised: Pick<Entry, 'id' | 'text'>[] = [];
  const problems: string[] = [];
  const review: string[] = [];
  const seen = new Set<number>();
  answers.forEach((answer, place) => {
    const matches = [...answer.matchAll(/^\[(\d+)\][ \t]*(?:\((?:설명|제목)\)[ \t]*)?(.*?)\s*$/gm)];
    // Sent numbers have gaps, so one that was never sent means the model renumbered or wrote its own list, and the
    // lines whose numbers happen to match are not answers to them either.
    const unsent = matches.map((match) => Number(match[1])).filter((number) => !list[number - 1] || !isSentence(list[number - 1]!));
    if (unsent.length) {
      problems.push(`answer ${place + 1}: ${unsent.length} of ${matches.length} lines were never sent (first ${unsent[0]}), so none of it is read`);
      return;
    }
    for (const match of matches) {
      const number = Number(match[1]);
      const entry = list[number - 1]!;
      if (seen.has(number)) {
        problems.push(`${number}: answered twice`);
        continue;
      }
      seen.add(number);
      if (match[2] === shownLine(entry)) continue;
      const text = fromLine(entry, match[2]!);
      if (typeof text !== 'string') problems.push(`${number} ${entry.id}: ${text.reason}`);
      else {
        revised.push({ id: entry.id, text });
        review.push(`${number} ${entry.id}\n   was: ${shownLine(entry)}\n   now: ${match[2]}`);
      }
    }
  });
  return { revised, problems, review, read: seen.size };
}

function read(paths: readonly string[]): Source[] {
  return paths.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
}

function main([command, out, revisedPath, ...answerPaths]: string[]) {
  const paths = [...globSync(SOURCES, { exclude: (path) => /\.test\.tsx?$|testing\.ts$/.test(path) }), ...PAGES].sort();
  if (command === 'extract' && out) {
    const entries: Listed[] = extract(read(paths)).map(({ id, kind, owner, context, text }) => ({ id, kind, owner, context, text }));
    writeFileSync(out, `[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);
    console.log(`${entries.length} entries from ${new Set(entries.map((entry) => pathOf(entry.id))).size} files → ${out}`);
  } else if (command === 'apply' && out && revisedPath) {
    const original = JSON.parse(readFileSync(out, 'utf8')) as Listed[];
    const revised = JSON.parse(readFileSync(revisedPath, 'utf8')) as Pick<Entry, 'id' | 'text'>[];
    const { written, rejected } = apply(read([...new Set(original.map((entry) => pathOf(entry.id)))]), original, revised);
    for (const { path, source } of written) writeFileSync(path, source);
    for (const { id, reason } of rejected) console.log(`rejected ${id}: ${reason}`);
    console.log(`${written.length} files written, ${rejected.length} entries rejected`);
  } else if (command === 'text' && out && revisedPath) {
    const batches = toText(JSON.parse(readFileSync(out, 'utf8')) as Listed[]);
    mkdirSync(revisedPath, { recursive: true });
    for (const { name, body } of batches) writeFileSync(`${revisedPath}/${name}`, body);
    console.log(`${batches.length} files → ${revisedPath}`);
  } else if (command === 'untext' && out && revisedPath && answerPaths.length) {
    const { revised, problems, review, read: count } = fromText(JSON.parse(readFileSync(out, 'utf8')) as Listed[], answerPaths.map((path) => readFileSync(path, 'utf8')));
    writeFileSync(revisedPath, JSON.stringify(revised, null, 1) + '\n');
    console.log([...review, ...problems.map((problem) => `problem ${problem}`), `${count} lines read, ${revised.length} changed, ${problems.length} problems → ${revisedPath}`].join('\n'));
  } else {
    console.log('usage: copy-text extract <out.json> | apply <out.json> <revised.json> | text <out.json> <dir> | untext <out.json> <revised.json> <answer.txt>...');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
