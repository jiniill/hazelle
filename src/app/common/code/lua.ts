import type { SyntaxProblem } from '../../../engine/lua/run';
import { nearest } from '../../../engine/edit-distance';
import type { CodeCompletion, CodeDoc, CodeItem, CodeLanguage, CodeProblem } from '../../ui';
import { withParticle } from '../particles';
import { LUA_API, LUA_EVENTS, LUA_INTERNAL, LUA_UNSUPPORTED, type LuaFunction } from './luaApi';
import { variableDoc, variableItems, type Variables } from './variables';

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
const GLOBALS = ['tonumber', 'tostring', 'pairs', 'ipairs', 'type', 'pcall', 'xpcall', 'error', 'assert', 'print', 'select', 'next', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal', 'rawlen', 'collectgarbage'];
const LIBRARY: Record<string, string[]> = {
  string: ['find(글, 찾을 글)', 'sub(글, 시작, 끝)', 'gsub(글, 패턴, 바꿀 글)', 'match(글, 패턴)', 'gmatch(글, 패턴)', 'format(형식, 값)', 'len(글)', 'lower(글)', 'upper(글)', 'rep(글, 횟수)', 'reverse(글)', 'byte(글)', 'char(번호)'],
  table: ['insert(테이블, 값)', 'remove(테이블, 위치)', 'concat(테이블, 구분자)', 'sort(테이블)', 'unpack(표)'],
  math: ['floor(숫자)', 'ceil(숫자)', 'max(가, 나)', 'min(가, 나)', 'random(시작, 끝)', 'abs(숫자)', 'sqrt(숫자)'],
  json: ['encode(값)', 'decode(글)'],
  os: ['time()', 'date(형식)', 'clock()'],
};
const SNIPPETS: [string, string][] = [
  ['if', 'if ${1:조건} then\n\t${0}\nend'],
  ['if else', 'if ${1:조건} then\n\t${2}\nelse\n\t${0}\nend'],
  ['for', 'for ${1:i} = ${2:1}, ${3:끝} do\n\t${0}\nend'],
  ['for pairs', 'for ${1:k}, ${2:v} in pairs(${3:표}) do\n\t${0}\nend'],
  ['while', 'while ${1:조건} do\n\t${0}\nend'],
  ['local function', 'local function ${1:이름}(${2})\n\t${0}\nend'],
];
// A keyword typed out whole, which no snippet starts with: a list opened on it would take the Enter after then or do.
const ENDS = new Set([...KEYWORDS].filter((keyword) => !SNIPPETS.some(([label]) => label.startsWith(keyword))));
const API = new Map([...LUA_API, ...LUA_EVENTS].map((entry) => [entry.name, entry]));
const KNOWN = new Set([...API.keys(), ...LUA_INTERNAL, ...LUA_UNSUPPORTED, ...GLOBALS, ...KEYWORDS, ...Object.keys(LIBRARY), 'require']);
// getState and its kin keep a value under its name with `__` before it (prelude.lua).
const VARIABLE_CALL = /\b(getChatVar|setChatVar|setChatVarChanged|getState|setState|setStateChanged)\(\s*\w+\s*,\s*"([^"\n]*)/;
const VARIABLE_SLOT = new RegExp(`${VARIABLE_CALL.source}$`);
const VARIABLE_NAME = new RegExp(`${VARIABLE_CALL.source}"`, 'g');

const argsOf = (form: string) => form.slice(form.indexOf('(') + 1, form.lastIndexOf(')')).split(',').map((arg) => arg.trim()).filter(Boolean);

// Every argument a stop, but id, which a script always passes as it got it.
export function callTemplate({ name, form, waits }: Pick<LuaFunction, 'name' | 'form' | 'waits'>) {
  let stop = 0;
  const args = argsOf(form).map((arg) => (arg === 'id' ? arg : `\${${++stop}:${arg}}`));
  return `${name}(${args.join(', ')})${waits ? ':await()' : ''}\${0}`;
}

const docOf = ({ form, text, waits }: LuaFunction): CodeDoc => ({ form: `${form}${waits ? ':await()' : ''}`, text: waits ? `${text} async 안에서 :await()로 기다려요.` : text });

// Comments and strings in one pass, so whichever starts first wins: `"--"` is a string, `-- "` a comment.
const blank = (text: string) => text.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\[(=*)\[[\s\S]*?\]\2\]/g, (match) => match.replace(/[^\n]/g, ' '));

// Names the code itself gives: functions, locals, parameters and assigned globals. A name only ever called is an API
// name or a typo; offering it would rank the typo over the API.
export function definedNames(text: string): Set<string> {
  const code = blank(text);
  const names = new Set<string>();
  for (const [, name] of code.matchAll(/\bfunction\s+([A-Za-z_]\w*)/g)) names.add(name!);
  for (const [, list] of code.matchAll(/\blocal\s+(?:function\s+)?([A-Za-z_][\w\s,]*)/g)) for (const name of list!.split(',')) if (/^\s*[A-Za-z_]\w*\s*$/.test(name)) names.add(name.trim());
  for (const [, list] of code.matchAll(/\bfunction\s*[\w.:]*\s*\(([^)]*)\)/g)) for (const name of list!.split(',')) if (/^\s*[A-Za-z_]\w*\s*$/.test(name)) names.add(name.trim());
  for (const [, list] of code.matchAll(/\bfor\s+([\w\s,]+?)\s+(?:in|=)/g)) for (const name of list!.split(',')) names.add(name.trim());
  for (const [, name] of code.matchAll(/(?:^|[;\s])([A-Za-z_]\w*)\s*=(?!=)/gm)) names.add(name!);
  for (const name of names) if (KEYWORDS.has(name) || !name) names.delete(name);
  return names;
}

// Lua's own wording, in Korean for the shapes a draft most often takes; any other stays as Lua says it.
export function syntaxMessage(message: string): string {
  const near = (token: string) => (token === '<eof>' ? '코드 끝' : token);
  let found = /^'(.+)' expected \(to close '(.+)' at line (\d+)\) near (.+)$/.exec(message);
  if (found) return `${found[3]}번째 줄 ${found[2]}의 짝인 ${withParticle(found[1]!, '이/가')} 없어요.`;
  found = /^'(.+)' expected near (.+)$/.exec(message);
  if (found) return `${near(found[2]!)} 자리에 ${withParticle(found[1]!, '이/가')} 와야 해요.`;
  found = /^unexpected symbol near (.+)$/.exec(message);
  if (found) return `${withParticle(near(found[1]!), '은/는')} 여기 올 수 없어요.`;
  if (message.startsWith('unfinished string')) return '문자열 따옴표를 닫아야 해요.';
  if (message.startsWith('unfinished long string') || message.startsWith('unfinished long comment')) return '주석이나 긴 문자열의 [[ ]]를 닫아야 해요.';
  if (message.startsWith('malformed number')) return '숫자 형식이 올바르지 않아요.';
  return message;
}

function lineRange(text: string, line: number): [number, number] {
  let from = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf('\n', from);
    if (next < 0) break;
    from = next + 1;
  }
  const end = text.indexOf('\n', from);
  return [from, end < 0 ? text.length : end];
}

function lint(text: string): CodeProblem[] {
  const code = blank(text);
  const defined = definedNames(text);
  const problems: CodeProblem[] = [];
  for (const found of code.matchAll(/(?<![.:\w])([A-Za-z_]\w*)\s*\(/g)) {
    const name = found[1]!;
    const from = found.index;
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, from - 12), from)) || defined.has(name)) continue;
    if (LUA_UNSUPPORTED.includes(name)) {
      problems.push({ from, to: from + name.length, severity: 'warning', message: `${withParticle(name, '은/는')} 헤이젤에 없어서 아무 일도 하지 않아요.` });
      continue;
    }
    if (KNOWN.has(name)) continue;
    const near = nearest(name.toLowerCase(), API.keys(), (known) => known.toLowerCase(), 2);
    if (near) problems.push({ from, to: from + name.length, severity: 'warning', message: `${near}의 오타 같아요.`, fix: { label: `${withParticle(near, '으로/로')} 바꾸기`, insert: near } });
  }
  return problems;
}

const storedPrefix = (call: string) => (call.includes('State') ? '__' : '');
const writtenNames = (text: string, prefix: string) => [...text.matchAll(VARIABLE_NAME)].flatMap(([, call, name]) => (name && storedPrefix(call!) === prefix ? [name] : []));

function complete(text: string, at: number, place: 'code' | 'string' | 'comment', explicit: boolean, variables: Variables): CodeCompletion | null {
  const before = text.slice(0, at);
  const slot = VARIABLE_SLOT.exec(before);
  if (slot && place === 'string') {
    const from = at - slot[2]!.length;
    const prefix = storedPrefix(slot[1]!);
    // The name being typed is no name the code has yet.
    return { from, items: variableItems(variables, writtenNames(text.slice(0, from) + text.slice(at), prefix), prefix), validFor: /^[^"\n]*$/ };
  }
  if (place !== 'code') return null;
  const member = /\b(string|table|math|json|os)\.(\w*)$/.exec(before);
  if (member) {
    const library = member[1]!;
    const items = LIBRARY[library]!.map((form): CodeItem => {
      const name = form.slice(0, form.indexOf('('));
      return { label: name, kind: 'function', detail: form.slice(name.length), template: callTemplate({ name, form }) };
    });
    return { from: at - member[2]!.length, items, validFor: /^\w*$/ };
  }
  const word = /[A-Za-z_]\w*$/.exec(before);
  if (!explicit && (!word || ENDS.has(word[0]))) return null;
  const from = at - (word?.[0].length ?? 0);
  if (/[.:]$/.test(text.slice(0, from))) return null;
  const others = definedNames(text.slice(0, from) + text.slice(at));
  // After a typed `function `, an event's snippet writes only its name onward.
  const declared = /\bfunction\s+$/.test(text.slice(0, from));
  const items: CodeItem[] = [
    ...LUA_API.map((entry): CodeItem => ({ label: entry.name, kind: 'function', detail: entry.form.slice(entry.name.length), template: callTemplate(entry), doc: docOf(entry) })),
    ...LUA_EVENTS.filter((entry) => !others.has(entry.name)).map((entry): CodeItem => ({ label: entry.name, kind: 'keyword', detail: '이벤트', template: `${declared ? '' : 'function '}${entry.form}\n\t\${0}\nend`, doc: docOf(entry) })),
    ...SNIPPETS.map(([label, template]): CodeItem => ({ label, kind: 'keyword', template, boost: 1 })),
    ...GLOBALS.map((name): CodeItem => ({ label: name, kind: 'function', detail: 'Lua', boost: -1 })),
    ...Object.keys(LIBRARY).map((name): CodeItem => ({ label: name, kind: 'namespace', detail: 'Lua', boost: -1 })),
    ...[...others].filter((name) => !API.has(name)).map((name): CodeItem => ({ label: name, kind: 'variable', detail: '이 코드', boost: 2 })),
  ];
  return { from, items, validFor: /^\w*$/ };
}

function explain(text: string, at: number, variables: Variables) {
  const line = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  const row = text.slice(line, end < 0 ? text.length : end);
  for (const found of row.matchAll(VARIABLE_NAME)) {
    const [whole, call, name] = found as unknown as [string, string, string];
    const from = line + found.index + whole.length - name.length - 1;
    if (at >= from && at <= from + name.length + 2) return { from, to: from + name.length + 2, doc: variableDoc(name, variables, storedPrefix(call) + name) };
  }
  let from = at;
  let to = at;
  while (from > 0 && /\w/.test(text[from - 1]!)) from--;
  while (to < text.length && /\w/.test(text[to]!)) to++;
  const entry = API.get(text.slice(from, to));
  return entry && !/[.:]$/.test(text.slice(0, from)) ? { from, to, doc: docOf(entry) } : null;
}

// check: the Lua VM's syntax check of a draft; unchecked when the VM could not be reached. variables: offered and
// explained by name.
export function luaLanguage(check: (code: string) => Promise<SyntaxProblem | null | 'unchecked'>, variables: Variables = { defaults: [], chat: null }): CodeLanguage {
  return {
    syntax: 'lua',
    lint: async (text) => {
      const problems = lint(text);
      const syntax = await check(text);
      if (!syntax) return problems;
      if (syntax === 'unchecked') return [{ from: 0, to: 0, severity: 'warning', message: '문법을 확인하지 못했어요.' }, ...problems];
      const [from, to] = syntax.line === null ? [0, 0] : lineRange(text, syntax.line);
      return [{ from, to, severity: 'error', message: syntaxMessage(syntax.message) }, ...problems];
    },
    complete: (text, at, place, explicit) => complete(text, at, place, explicit, variables),
    explain: (text, at) => explain(text, at, variables),
  };
}
