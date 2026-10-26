import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { c, cpp, csharp, dart, java, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { css, less, sCSS } from '@codemirror/legacy-modes/mode/css';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { python } from '@codemirror/legacy-modes/mode/python';
import { r } from '@codemirror/legacy-modes/mode/r';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { CODE_ROLES } from '../controls/codeRoles';

// A fence's language as people write it after ```, lower-cased.
const MODES: Record<string, StreamParser<unknown>> = {
  javascript, js: javascript, jsx: javascript, mjs: javascript, cjs: javascript,
  typescript, ts: typescript, tsx: typescript, json, jsonc: json,
  python, py: python, c, h: c, cpp, 'c++': cpp, cc: cpp, hpp: cpp, java, csharp, cs: csharp, kotlin, kt: kotlin, scala, dart,
  go, golang: go, rust, rs: rust, shell, sh: shell, bash: shell, zsh: shell, powershell: powerShell, ps1: powerShell, pwsh: powerShell,
  sql: standardSQL, yaml, yml: yaml, toml, css, scss: sCSS, less, html, xml, svg: xml, lua, ruby, rb: ruby, swift,
  diff, patch: diff, dockerfile: dockerFile, docker: dockerFile, r, perl, pl: perl,
};
const parsers = new Map<StreamParser<unknown>, StreamLanguage<unknown>['parser']>();
const highlighter = tagHighlighter(CODE_ROLES.map(({ tag, role }) => ({ tag, class: `code-${role}` })));

// What markdown-it's fences and {{codeblock}} escape. A bot's own code block that holds markup, or another entity, is
// left as written: decoding it here would change what it shows.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const ENTITY = /&(?:amp|lt|gt|quot|#39);/g;
const FOREIGN_ENTITY = /&(?!(?:amp|lt|gt|quot|#39);)/;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]!);
const FENCE = /<pre><code class="language-([^"\s]+)">([^<]*)<\/code><\/pre>/g;

// The code of a fence whose language is known, split into its highlighted pieces; another is left as it is.
export function drawCode(htmlText: string): string {
  return htmlText.replace(FENCE, (fence, language: string, escaped: string) => {
    const mode = MODES[language.toLowerCase()];
    if (!mode || FOREIGN_ENTITY.test(escaped)) return fence;
    let parser = parsers.get(mode);
    if (!parser) parsers.set(mode, (parser = StreamLanguage.define(mode).parser));
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
