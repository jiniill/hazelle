import MarkdownIt, { type StateCore, type StateInline, type Token } from 'markdown-it';
import { INLAY_MARKUP } from './assets';
import { unescapeCbs } from './cbs/escape';
import { evaluate, Runaway } from './cbs/evaluate';
import type { Box } from './regex/scripts';
import { contexts, renderChat, type ChatScope, type LuaDisplay, type Missed } from './render';

// texts: each message's text as shown, its <style> blocks taken out. css: what those blocks and the packs'
// backgroundHTML carry. As in Risu, it applies to every message of the chat, not only the one that carried it.
// unfound: the asset names its tags found no picture for, backgroundHTML's included.
// drawn: the display scripts, by place among the packs' regex, that drew a box in each message; boxes: each message's
// boxes taken out of it (상태창 지정), their <style> blocks in css too. pass: whether the bot's Lua editDisplay pass
// still has pending messages (lua). stopped: the bot's commands in a message or a backgroundHTML that ran away (renderChat); a
// backgroundHTML that did is left out.
export type Display = { texts: string[]; css: string; drawn: number[][]; boxes: Box[][]; pass: boolean; unfound: string[]; stopped: Runaway | null };

export type DisplayWork = { items: Missed[]; staged: string[]; start: [string, string][] };
export type DisplayPatch = { rows: { index: number; text: string; drawn: number[]; boxes: Box[] }[]; css: string; pass: boolean; unfound: string[]; stopped: Runaway | null };

export const display = (scope: ChatScope, take: ReadonlySet<number> = new Set(), lua?: LuaDisplay): Display => new DisplayPass(scope, take, lua).value;

export class DisplayPass {
  readonly value: Display;
  readonly work: DisplayWork | null;
  private readonly rendered: ReturnType<typeof renderChat>;
  private readonly byVersion: Map<string, number>;
  private readonly missing: Set<string>;
  private readonly background: string[] = [];
  private readonly textStyles: string[][];
  private readonly boxStyles: string[][];
  private backgroundStop: Runaway | null = null;

  constructor(scope: ChatScope, take: ReadonlySet<number>, lua?: LuaDisplay) {
    const rendered = renderChat('display', scope, take, lua);
    this.rendered = rendered;
    this.byVersion = new Map(scope.messages.map(({ id }, index) => [id, index]));
    this.missing = new Set(rendered.missed.map(({ version }) => version));
    this.work = rendered.missed.length ? { items: rendered.missed, staged: rendered.staged, start: rendered.start } : null;
    // Read with the variables as the last message left them, as Risu reads it with the chat's current ones, and passed
    // through the display scripts as Risu passes it: bots fill placeholders in their CSS ({border}, <<PCFont>>) there.
    const cbs = (text: string) => evaluate(text, contexts(scope, 'display', null, '', rendered.unfound)({ seed: 'background' }, rendered.variables));
    for (const { background } of scope.packs) {
      if (!background) continue;
      try {
        stripStyles(unescapeCbs(rendered.scripts.apply('display', background, { index: -1, cbs }).text), this.background);
      } catch (error) {
        if (!(error instanceof Runaway)) throw error;
        this.backgroundStop ??= error;
      }
    }
    this.textStyles = rendered.texts.map(() => []);
    this.boxStyles = rendered.boxes.map(() => []);
    const texts = rendered.texts.map((text, index) => stripStyles(text, this.textStyles[index]!));
    const boxes = rendered.boxes.map((rows, index) => rows.map((box) => ({ ...box, html: stripStyles(box.html, this.boxStyles[index]!) })));
    this.value = { texts, boxes, drawn: rendered.drawn, css: this.css(), pass: this.missing.size > 0, unfound: [...rendered.unfound!], stopped: rendered.stopped ?? this.backgroundStop };
  }

  patch(items: { version: string; text: string }[]): DisplayPatch {
    const rows: DisplayPatch['rows'] = [];
    for (const { version, text } of items) {
      const index = this.byVersion.get(version);
      if (index === undefined) continue;
      const next = this.rendered.finish!(index, text);
      if (next.stopped) this.rendered.failures.display.set(index, next.stopped);
      else this.rendered.failures.display.delete(index);
      this.textStyles[index] = [];
      this.boxStyles[index] = [];
      const row = { index, text: stripStyles(next.text, this.textStyles[index]!), drawn: next.drawn, boxes: next.boxes.map((box) => ({ ...box, html: stripStyles(box.html, this.boxStyles[index]!) })) };
      rows.push(row);
      this.value.texts[index] = row.text;
      this.value.drawn[index] = row.drawn;
      this.value.boxes[index] = row.boxes;
      this.missing.delete(version);
    }
    let first = Infinity;
    let stopped: Runaway | null = null;
    for (const errors of [this.rendered.failures.input, this.rendered.failures.display]) for (const [index, error] of errors) {
      if (index < first) { first = index; stopped = error; }
    }
    const patch = { rows, css: this.css(), pass: this.missing.size > 0, unfound: [...this.rendered.unfound!], stopped: stopped ?? this.backgroundStop };
    this.value.css = patch.css;
    this.value.unfound = patch.unfound;
    this.value.pass = patch.pass;
    this.value.stopped = patch.stopped;
    return patch;
  }

  private css(): string {
    // Styles cascade in the original order: backgrounds, every text, then every taken box, not text/box pairs.
    return [...new Set([...this.background, ...this.textStyles.flat(), ...this.boxStyles.flat()].map((block) => block.trim()))].join('\n');
  }
}

// A <style> left open runs to the end of its text, as a browser reads it; bots' backgroundHTML often ends that way.
// One pass, taking what /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi takes: that regex rescans to the end for each
// opener with no > after it, and no opener after that one has a > either.
export function stripStyles(text: string, blocks: string[]): string {
  const opener = /<style\b/gi;
  const closer = /<\/style\s*>/gi;
  let kept = '';
  let from = 0;
  for (let found = opener.exec(text); found; found = opener.exec(text)) {
    const open = text.indexOf('>', opener.lastIndex);
    if (open === -1) break;
    closer.lastIndex = open + 1;
    const end = closer.exec(text);
    blocks.push(text.slice(open + 1, end ? end.index : text.length));
    kept += text.slice(from, found.index);
    from = opener.lastIndex = end ? closer.lastIndex : text.length;
  }
  return kept + text.slice(from);
}

// Markdown as Risu parses it (markdown-it, soft breaks kept, no indented code), so a bot's HTML blocks and the prose
// between them split where they did there. The prose is the app's: each line its own paragraph, and its marks read
// by `marks` rather than markdown's emphasis, which misses Korean text such as *끄덕였다.*그리고.
function parser(html: boolean) {
  const md = new MarkdownIt({ html, breaks: true, linkify: false, typographer: false });
  md.disable(['code', 'emphasis']);
  md.inline.ruler.before('escape', 'story_formula', formula);
  md.renderer.rules.formula = (tokens, index) => `<span data-tex>${md.utils.escapeHtml(tokens[index]!.content)}</span>`;
  // Before text_join, so an escaped \* is still its own token and not read as a mark.
  md.core.ruler.before('text_join', 'story_lines', lines);
  md.core.ruler.after('story_lines', 'story_marks', marks);
  if (html) md.core.ruler.after('story_marks', 'picture_lines', pictureLines);
  else {
    md.inline.ruler.before('html_inline', 'inlay', inlay);
    md.core.ruler.after('story_marks', 'inlay_blocks', inlayBlocks);
  }
  return md;
}

// A picture at the start of a line stands as its own line, as ![]() alone does: the story's picture lines (Story.tsx
// data-picture) are paragraphs holding only a picture, and one left bare or followed by text would escape their cap.
// {{img::}} and {{asset::}} leave one either as an HTML block of its own or ahead of the line's text. One later in the
// line stays in it.
const PICTURE = /^\s*<img\b[^<>]*>\s*$/i;
function pictureLines(state: StateCore) {
  const out: Token[] = [];
  state.tokens.forEach((token, index) => {
    const open = state.tokens[index - 1];
    const [first, ...rest] = token.children ?? [];
    if (token.type === 'html_block' && PICTURE.test(token.content)) token.content = `<p>${token.content.trim()}</p>\n`;
    const leads = token.type === 'inline' && open?.type === 'paragraph_open' && !open.hidden && first?.type === 'html_inline' && PICTURE.test(first.content);
    if (!leads || rest.every((child) => child.type === 'text' && !child.content.trim())) return void out.push(token);
    if (rest[0]!.type === 'text') rest[0]!.content = rest[0]!.content.trimStart();
    out.push(
      Object.assign(new state.Token('inline', '', 0), { children: [first] }),
      Object.assign(new state.Token('paragraph_close', 'p', -1), { block: true }),
      Object.assign(new state.Token('paragraph_open', 'p', 1), { block: true }),
      Object.assign(new state.Token('inline', '', 0), { children: rest }),
    );
  });
  state.tokens = out;
}

// Without the bot's HTML, the chat's inlays still show: their markup alone is kept (engine/assets INLAY_MARKUP).
function inlay(state: StateInline, silent: boolean) {
  INLAY_MARKUP.lastIndex = state.pos;
  const found = INLAY_MARKUP.exec(state.src);
  if (!found) return false;
  if (!silent) Object.assign(state.push('html_inline', '', 0), { content: found[0], meta: { block: found[1] !== undefined } });
  state.pos += found[0].length;
  return true;
}

// A line that is only a wrapped inlay stands as its own block, as the bot's HTML parse leaves it, not inside a paragraph.
function inlayBlocks(state: StateCore) {
  state.tokens = state.tokens.flatMap((token, index, tokens) => {
    const lone = (at: number) => {
      const children = tokens[at]?.children;
      return tokens[at - 1]?.type === 'paragraph_open' && children?.length === 1 && (children[0]!.meta as { block?: boolean } | null)?.block === true;
    };
    if (token.type === 'paragraph_open' && lone(index + 1)) return [];
    if (token.type === 'paragraph_close' && lone(index - 1)) return [];
    if (token.type === 'inline' && lone(index)) return [Object.assign(new state.Token('html_block', '', 0), { content: token.children![0]!.content, block: true })];
    return [token];
  });
}
const BOT = parser(true);
const PLAIN = parser(false);

// bot: the bot's HTML is kept, for the sanitizer to take what it allows; without it, tags show as text.
export const storyHtml = (text: string, bot: boolean) => (bot ? BOT : PLAIN).render(text);

// $$…$$ is one token, so markdown's escapes and the marks leave a formula's \\, \{, * and " as written. The screen
// draws it (src/app/ui/story/math.ts, which reads this span) and shows it as written until then or when it cannot. A
// pair not yet closed is text, so a streaming reply draws a formula once it is whole.
function formula(state: StateInline, silent: boolean) {
  if (!state.src.startsWith('$$', state.pos)) return false;
  const end = state.src.indexOf('$$', state.pos + 3);
  if (end === -1) return false;
  if (!silent) state.push('formula', '', 0).content = state.src.slice(state.pos, end + 2);
  state.pos = end + 2;
  return true;
}

// A tight list's hidden paragraphs keep their breaks.
// A paragraph holding block-level HTML is the bot's markup that markdown read as text (a line indented with
// non-breaking spaces starts no HTML block). It stays one paragraph joined by <br>, as Risu renders it: a <p> per line
// wrapped the bot's elements apart, and an <input> no longer beside the panel its :checked ~ rule opens.
const BLOCK_HTML = /^<\/?(?:div|p|fieldset|form|address|table|thead|tbody|tfoot|tr|td|th|section|article|aside|header|footer|nav|main|figure|figcaption|details|summary|ul|ol|li|dl|dt|dd|blockquote|center|h[1-6]|hr|pre)(?=[\s/>])/i;
const holdsMarkup = (token: Token) => token.children!.some((child) => child.type === 'html_inline' && BLOCK_HTML.test(child.content));

function lines(state: StateCore) {
  const out: Token[] = [];
  state.tokens.forEach((token, index) => {
    const open = state.tokens[index - 1]!;
    if (token.type !== 'inline' || open.type !== 'paragraph_open' || open.hidden || (state.md.options.html && holdsMarkup(token))) return void out.push(token);
    const groups: Token[][] = [[]];
    for (const child of token.children!) {
      if (child.type === 'softbreak') groups.push([]);
      else groups.at(-1)!.push(child);
    }
    groups.forEach((children, at) => {
      if (at > 0) out.push(Object.assign(new state.Token('paragraph_close', 'p', -1), { block: true }), Object.assign(new state.Token('paragraph_open', 'p', 1), { block: true }));
      out.push(Object.assign(new state.Token('inline', '', 0), { children }));
    });
  });
  state.tokens = out;
}

type Mark = '**' | '*' | '"' | '“' | "'" | '‘';
const MARK = /\*\*|\*|"|“|”|'|‘|’/g;
const TAGS: Record<Mark, { type: string; tag: string }> = { '**': { type: 'strong', tag: 'strong' }, '*': { type: 'em', tag: 'em' }, '"': { type: 'mark', tag: 'mark' }, '“': { type: 'mark', tag: 'mark' }, "'": { type: 'mark', tag: 'mark' }, '‘': { type: 'mark', tag: 'mark' } };
// Risu's names: quote2 for dialogue, quote1 for 속마음.
const QUOTES: Partial<Record<Mark, string>> = { '"': 'quote2', '“': 'quote2', "'": 'quote1', '‘': 'quote1' };
// don't, it’s: an apostrophe after a Latin letter or digit, before a letter. A Korean '속마음'이라고 closes its quote.
const APOSTROPHE_BEFORE = /[\p{Script=Latin}\d]/u;
const APOSTROPHE_AFTER = /[\p{L}\d]/u;

// *Actions* lose their asterisks and **bold** its pairs; “dialogue” and "dialogue", ‘속마음’ and '속마음' keep their
// quotes, in the marks Risu gives them, so a bot's CSS for them applies. A mark left open runs to the end of its line,
// which is how a reply looks while it streams. A ' followed by a space or the line's end opens nothing (the users' book).
function marks(state: StateCore) {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const out: Token[] = [];
    const open: Mark[] = [];
    const tag = (mark: Mark, nesting: 1 | -1) => {
      const { type, tag } = TAGS[mark];
      const token = new state.Token(nesting === 1 ? `${type}_open` : `${type}_close`, tag, nesting);
      if (nesting === 1 && type === 'mark') token.attrSet('risu-mark', QUOTES[mark]!);
      out.push(token);
    };
    const text = (content: string) => content && out.push(Object.assign(new state.Token('text', '', 0), { content }));
    const close = (from: number) => {
      const above = open.splice(from);
      for (const mark of above.toReversed()) tag(mark, -1);
      return above.slice(1);
    };
    for (const child of token.children!) {
      if (child.type === 'softbreak' || child.type === 'hardbreak') close(0);
      if (child.type !== 'text') {
        out.push(child);
        continue;
      }
      let last = 0;
      for (const match of child.content.matchAll(MARK)) {
        const [mark] = match;
        text(child.content.slice(last, match.index));
        last = match.index + mark.length;
        const after = child.content[last] ?? '';
        if ((mark === "'" || mark === '’') && APOSTROPHE_BEFORE.test(child.content[match.index - 1] ?? '') && APOSTROPHE_AFTER.test(after)) {
          text(mark);
          continue;
        }
        const found = mark === '”' ? '“' : mark === '’' ? '‘' : (mark as Mark);
        const at = mark === '“' || mark === '‘' ? -1 : open.lastIndexOf(found);
        if (at === -1 && (mark === '”' || mark === '’' || (mark === "'" && !after.trim()))) {
          text(mark);
        } else if (at === -1) {
          open.push(found);
          tag(found, 1);
          if (QUOTES[found]) text(mark);
        } else {
          if (QUOTES[found]) text(mark);
          // Closing a mark that another opened inside of closes that one too, and opens it again after.
          for (const mark of close(at)) {
            open.push(mark);
            tag(mark, 1);
          }
        }
      }
      text(child.content.slice(last));
    }
    close(0);
    token.children = out;
  }
}
