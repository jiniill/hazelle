import { execFileSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Copy-only extract/apply pipeline: template literals are split into nonoverlapping literal runs;
// a numbered text/untext list lets a model rewrite copy without source code.

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
  if (entry.kind === 'string' && !isOneString(text, source[entry.span[0] - 1]!)) {
    const other = source[entry.span[0] - 1] === "'" ? '"' : "'";
    if (!isOneString(text, other)) return 'not one string literal in either quotes';
    return [{ start: entry.span[0] - 1, end: entry.span[1] + 1, text: `${other}${text}${other}` }];
  }
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

// Give models numbered lines only: source context encouraged invention. [N] survives Markdown renumbering and keeps
// the extract index; ${…} becomes {1}, {2}… .
const SYNTAX_OWNER = /(?:^|› )(?:form|example|written|result|card|name|variables|toggle|SAMPLE_NOTE)$/;
const ROLE: [RegExp, string][] = [
  [/(?:help|hint|HELP)$/, '(설명) '],
  [/(?:title|heading)$/, '(제목) '],
];

function isCopy(entry: Listed): boolean {
  if (/^src\/app\/common\/(legal|release)\.ts:/.test(entry.id)) return false;
  if (/^src\/app\/prompts\/(commands|guides)\.ts:/.test(entry.id) && SYNTAX_OWNER.test(entry.owner)) return false;
  const line = shownLine(entry);
  return !!line && !line.includes('\n');
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

// One file of every copy line, under a `## path` heading per file; with `changed`, only the lines on changed source lines.
export function toText(list: readonly Listed[], changed?: ReadonlyMap<string, ReadonlySet<number>>): string {
  let heading = '';
  const lines = list.flatMap((entry, index) => {
    const path = pathOf(entry.id);
    if (!isCopy(entry) || (changed && !changed.get(path)?.has(Number(entry.id.split(':')[1])))) return [];
    const role = ROLE.find(([owner]) => owner.test(entry.owner))?.[1] ?? '';
    const line = `[${index + 1}] ${role}${shownLine(entry)}`;
    if (path === heading) return [line];
    heading = path;
    return ['', `## ${path}`, line];
  });
  return `${lines.join('\n').trimStart()}\n`;
}

const unmark = (text: string) => text.replace(/^\((?:설명|제목)\)[ \t]*/, '');

// An answer line is `[N] current text ⇒ new text`. A model's numbers drift on a long list, so N counts only when its
// line shows that current text; otherwise the one line that shows it is meant.
export function fromText(list: readonly Listed[], answers: readonly string[]) {
  const shown = list.map((entry) => (isCopy(entry) ? shownLine(entry) : null));
  const showing = new Map<string, number[]>();
  shown.forEach((text, index) => text && showing.set(text, [...(showing.get(text) ?? []), index]));
  const revised: Pick<Entry, 'id' | 'text'>[] = [];
  const problems: string[] = [];
  const review: string[] = [];
  const seen = new Set<number>();
  for (const match of answers.flatMap((answer) => [...answer.matchAll(/^\[(\d+)\][ \t]*(.*?)[ \t]*⇒[ \t]*(.*?)\s*$/gm)])) {
    const [old, now] = [unmark(match[2]!), unmark(match[3]!)];
    const sent = Number(match[1]) - 1;
    const places = showing.get(old) ?? [];
    const index = shown[sent] === old ? sent : places.length === 1 ? places[0]! : undefined;
    if (index === undefined) {
      problems.push(`[${match[1]}] ${old}: ${places.length ? 'shown on several lines, and not on this one' : 'no line shows this text'}`);
      continue;
    }
    if (seen.has(index)) {
      problems.push(`${index + 1}: answered twice`);
      continue;
    }
    seen.add(index);
    if (now === old) continue;
    const entry = list[index]!;
    const text = fromLine(entry, now);
    if (typeof text !== 'string') problems.push(`${index + 1} ${entry.id}: ${text.reason}`);
    else {
      revised.push({ id: entry.id, text });
      review.push(`${index + 1} ${entry.id}\n   was: ${old}\n   now: ${now}`);
    }
  }
  return { revised, problems, review, read: seen.size };
}

// Source lines added or changed since ref, untracked files whole.
function changedSince(ref: string): Map<string, Set<number>> {
  const changed = new Map<string, Set<number>>();
  let path = '';
  for (const line of execFileSync('git', ['diff', '-U0', '--no-color', ref], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')) {
    if (line.startsWith('+++ ')) path = line.slice(6);
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const lines = changed.get(path) ?? new Set<number>();
    for (let at = Number(hunk[1]); at < Number(hunk[1]) + Number(hunk[2] ?? 1); at++) lines.add(at);
    changed.set(path, lines);
  }
  for (const untracked of execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    changed.set(untracked, new Set(readFileSync(untracked, 'utf8').split('\n').map((_, index) => index + 1)));
  }
  return changed;
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
    const body = toText(JSON.parse(readFileSync(out, 'utf8')) as Listed[], answerPaths[0] ? changedSince(answerPaths[0]) : undefined);
    writeFileSync(revisedPath, body);
    console.log(`${body.split('\n').filter((line) => line.startsWith('[')).length} lines → ${revisedPath}`);
  } else if (command === 'untext' && out && revisedPath && answerPaths.length) {
    const { revised, problems, review, read: count } = fromText(JSON.parse(readFileSync(out, 'utf8')) as Listed[], answerPaths.map((path) => readFileSync(path, 'utf8')));
    writeFileSync(revisedPath, JSON.stringify(revised, null, 1) + '\n');
    console.log([...review, ...problems.map((problem) => `problem ${problem}`), `${count} lines read, ${revised.length} changed, ${problems.length} problems → ${revisedPath}`].join('\n'));
  } else {
    console.log('usage: copy-text extract <out.json> | apply <out.json> <revised.json> | text <out.json> <lines.txt> [<git ref>] | untext <out.json> <revised.json> <answer.txt>...');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
