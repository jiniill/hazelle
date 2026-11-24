import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { CODE_ROLES } from '../controls/codeRoles';

// A mode comes with the first fence that names it; a module of several modes is fetched once for them all.
type Mode = () => Promise<StreamParser<unknown>>;
type Modes<K extends string> = () => Promise<Record<K, StreamParser<unknown>>>;
const mode = <K extends string>(load: Modes<K>, name: K): Mode => () => load().then((modes) => modes[name]);
const clike = () => import('@codemirror/legacy-modes/mode/clike');
const stylesheet = () => import('@codemirror/legacy-modes/mode/css');
const script = () => import('@codemirror/legacy-modes/mode/javascript');
const markup = () => import('@codemirror/legacy-modes/mode/xml');
const javascript = mode(script, 'javascript');
const typescript = mode(script, 'typescript');
const json = mode(script, 'json');
const python = mode(() => import('@codemirror/legacy-modes/mode/python'), 'python');
const c = mode(clike, 'c');
const cpp = mode(clike, 'cpp');
const java = mode(clike, 'java');
const csharp = mode(clike, 'csharp');
const kotlin = mode(clike, 'kotlin');
const scala = mode(clike, 'scala');
const dart = mode(clike, 'dart');
const go = mode(() => import('@codemirror/legacy-modes/mode/go'), 'go');
const rust = mode(() => import('@codemirror/legacy-modes/mode/rust'), 'rust');
const shell = mode(() => import('@codemirror/legacy-modes/mode/shell'), 'shell');
const powerShell = mode(() => import('@codemirror/legacy-modes/mode/powershell'), 'powerShell');
const standardSQL = mode(() => import('@codemirror/legacy-modes/mode/sql'), 'standardSQL');
const yaml = mode(() => import('@codemirror/legacy-modes/mode/yaml'), 'yaml');
const toml = mode(() => import('@codemirror/legacy-modes/mode/toml'), 'toml');
const css = mode(stylesheet, 'css');
const sCSS = mode(stylesheet, 'sCSS');
const less = mode(stylesheet, 'less');
const html = mode(markup, 'html');
const xml = mode(markup, 'xml');
const lua = mode(() => import('@codemirror/legacy-modes/mode/lua'), 'lua');
const ruby = mode(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby');
const swift = mode(() => import('@codemirror/legacy-modes/mode/swift'), 'swift');
const diff = mode(() => import('@codemirror/legacy-modes/mode/diff'), 'diff');
const dockerFile = mode(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile');
const r = mode(() => import('@codemirror/legacy-modes/mode/r'), 'r');
const perl = mode(() => import('@codemirror/legacy-modes/mode/perl'), 'perl');

// A fence's language as people write it after ```, lower-cased.
const MODES: Record<string, Mode> = {
  javascript, js: javascript, jsx: javascript, mjs: javascript, cjs: javascript,
  typescript, ts: typescript, tsx: typescript, json, jsonc: json,
  python, py: python, c, h: c, cpp, 'c++': cpp, cc: cpp, hpp: cpp, java, csharp, cs: csharp, kotlin, kt: kotlin, scala, dart,
  go, golang: go, rust, rs: rust, shell, sh: shell, bash: shell, zsh: shell, powershell: powerShell, ps1: powerShell, pwsh: powerShell,
  sql: standardSQL, yaml, yml: yaml, toml, css, scss: sCSS, less, html, xml, svg: xml, lua, ruby, rb: ruby, swift,
  diff, patch: diff, dockerfile: dockerFile, docker: dockerFile, r, perl, pl: perl,
};
// A mode's parser once it has come; null when it could not, whose fences stay as written.
const parsers = new Map<Mode, StreamLanguage<unknown>['parser'] | null>();
const loads = new Map<Mode, Promise<void>>();
const highlighter = tagHighlighter(CODE_ROLES.map(({ tag, role }) => ({ tag, class: `code-${role}` })));

// Own names only: "constructor" is a fence's language too, and Object's is no mode.
const modeOf = (language: string) => {
  const name = language.toLowerCase();
  return Object.hasOwn(MODES, name) ? MODES[name] : undefined;
};

// What markdown-it's fences and {{codeblock}} escape. A bot's own code block that holds markup, or another entity, is
// left as written: decoding it here would change what it shows.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const ENTITY = /&(?:amp|lt|gt|quot|#39);/g;
const FOREIGN_ENTITY = /&(?!(?:amp|lt|gt|quot|#39);)/;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]!);
const FENCE = /<pre><code class="language-([^"\s]+)">([^<]*)<\/code><\/pre>/g;

// Settles once every mode the HTML's fences name has come or failed; undefined when they all have, so drawCode draws it whole.
export function modesFor(htmlText: string): Promise<unknown> | undefined {
  const missing = [...htmlText.matchAll(FENCE)].map(([, language]) => modeOf(language!)).filter((mode): mode is Mode => mode !== undefined && !parsers.has(mode));
  return missing.length === 0 ? undefined : Promise.all(missing.map(load));
}

function load(mode: Mode) {
  let loading = loads.get(mode);
  if (!loading) {
    loading = mode().then(
      (stream) => void parsers.set(mode, StreamLanguage.define(stream).parser),
      () => void parsers.set(mode, null),
    );
    loads.set(mode, loading);
  }
  return loading;
}

// Draws the fences whose modes have come (modesFor).
export function drawCode(htmlText: string): string {
  return htmlText.replace(FENCE, (fence, language: string, escaped: string) => {
    const mode = modeOf(language);
    const parser = mode && parsers.get(mode);
    if (!parser || FOREIGN_ENTITY.test(escaped)) return fence;
    const code = escaped.replace(ENTITY, (entity) => ENTITIES[entity]!);
    let drawn = '';
    let at = 0;
    highlightTree(parser.parse(code), highlighter, (from, to, classes) => {
      drawn += `${escape(code.slice(at, from))}<span class="${classes}">${escape(code.slice(from, to))}</span>`;
      at = to;
    });
    return `<pre><code class="language-${language}">${drawn}${escape(code.slice(at))}</code></pre>`;
  });
}
