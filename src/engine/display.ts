import MarkdownIt, { type StateCore, type StateInline, type Token } from 'markdown-it';
import { assetsOf, assetUrl, mainOf, OWN_MARKUP } from './assets';
import { unescapeCbs } from './cbs/escape';
import { evaluate, Runaway } from './cbs/evaluate';
import { BACKGROUND } from './cbs/tags';
import type { RanAway } from './pipeline';
import type { Box } from './regex/scripts';
import { contexts, renderChat, type ChatScope, type LuaDisplay, type Missed } from './render';

// Extract styles from texts, status boxes and pack backgroundHTML into chat-wide css, as Risu does.
// drawn indexes pack regex per message; boxes are the extracted 상태창 지정 output. unfound includes background assets.
// picture: the character's background asset, which Risu keeps but never draws, for the app to draw under background;
// null when it has none. background: the packs' backgroundHTML past CBS and the display regex, its styles taken out,
// which Risu draws behind the chat; '' when only styles stand there.
// pass means Lua editDisplay has pending messages; stopped records a Runaway, with runaway backgroundHTML omitted.
export type Display = { texts: string[]; css: string; picture: string | null; background: string; drawn: number[][]; boxes: Box[][]; pass: boolean; unfound: string[]; stopped: Runaway | null };

export type DisplayWork = { items: Missed[]; staged: string[]; start: [string, string][] };
export type DisplayPatch = { rows: { index: number; text: string; drawn: number[]; boxes: Box[] }[]; css: string; pass: boolean; unfound: string[]; stopped: Runaway | null };

export const display = (scope: ChatScope, take: ReadonlySet<number> = new Set(), lua?: LuaDisplay): Display => new DisplayPass(scope, take, lua).value;

export class DisplayPass {
  readonly value: Display;
  readonly work: DisplayWork | null;
  private readonly rendered: ReturnType<typeof renderChat>;
  private readonly byVersion: Map<string, number>;
  private readonly missing: Set<string>;
  private readonly backgroundStyles: string[] = [];
  private readonly textStyles: string[][];
  private readonly boxStyles: string[][];
  // The CBS the display runs outside any message: the backgroundHTML's and a <risu-style>'s.
  private readonly cbs: (text: string) => string;
  // A <risu-style>'s CSS as its CBS reads it, by that CSS: everything the read takes is fixed for the pass.
  private readonly styles = new Map<string, string>();
  private ownStop: Runaway | null = null;

  constructor(scope: ChatScope, take: ReadonlySet<number>, lua?: LuaDisplay) {
    const rendered = renderChat('display', scope, take, lua);
    this.rendered = rendered;
    this.byVersion = new Map(scope.messages.map(({ id }, index) => [id, index]));
    this.missing = new Set(rendered.missed.map(({ version }) => version));
    this.work = rendered.missed.length ? { items: rendered.missed, staged: rendered.staged, start: rendered.start } : null;
    // Read with the variables as the last message left them, as Risu reads it with the chat's current ones, and passed
    // through the display scripts as Risu passes it: bots fill placeholders in their CSS ({border}, <<PCFont>>) there.
    // A <risu-style>'s CSS is read the same way, outside any message, as Risu reads it when it draws one.
    this.cbs = outside(scope, rendered, BACKGROUND);
    const main = mainOf(assetsOf(scope.assets, 'background'));
    const background: string[] = [];
    for (const pack of scope.packs) {
      if (!pack.background) continue;
      try {
        background.push(this.stripStyles(unescapeCbs(rendered.scripts.apply('display', pack.background, { index: -1, cbs: this.cbs }).text), this.backgroundStyles));
      } catch (error) {
        if (!(error instanceof Runaway)) throw error;
        this.ownStop ??= error;
      }
    }
    this.textStyles = rendered.texts.map(() => []);
    this.boxStyles = rendered.boxes.map(() => []);
    const texts = rendered.texts.map((text, index) => this.stripStyles(text, this.textStyles[index]!));
    const boxes = rendered.boxes.map((rows, index) => rows.map((box) => ({ ...box, html: this.stripStyles(box.html, this.boxStyles[index]!) })));
    // Joined as Risu joins the character's to the modules'.
    this.value = { texts, boxes, drawn: rendered.drawn, css: this.css(), picture: main ? assetUrl(main.id) : null, background: background.join('\n').trim(), pass: this.missing.size > 0, unfound: [...rendered.unfound!], stopped: rendered.stopped ?? this.ownStop };
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
      const row = { index, text: this.stripStyles(next.text, this.textStyles[index]!), drawn: next.drawn, boxes: next.boxes.map((box) => ({ ...box, html: this.stripStyles(box.html, this.boxStyles[index]!) })) };
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
    const patch = { rows, css: this.css(), pass: this.missing.size > 0, unfound: [...this.rendered.unfound!], stopped: stopped ?? this.ownStop };
    this.value.css = patch.css;
    this.value.unfound = patch.unfound;
    this.value.pass = patch.pass;
    this.value.stopped = patch.stopped;
    return patch;
  }

  // A <risu-style> whose CBS runs away is left empty, and the display says it stopped.
  private stripStyles(text: string, blocks: string[]): string {
    return stripStyles(text, blocks, (css) => {
      let read = this.styles.get(css);
      if (read !== undefined) return read;
      try {
        read = unescapeCbs(this.cbs(css));
      } catch (error) {
        if (!(error instanceof Runaway)) throw error;
        this.ownStop ??= error;
        read = '';
      }
      this.styles.set(css, read);
      return read;
    });
  }

  private css(): string {
    // Styles cascade in the original order: backgrounds, every text, then every taken box, not text/box pairs.
    return [...new Set([...this.backgroundStyles, ...this.textStyles.flat(), ...this.boxStyles.flat()].map((block) => block.trim()))].join('\n');
  }
}

// CBS read outside any message, which writes no variable.
function outside(scope: ChatScope, rendered: ReturnType<typeof renderChat>, seed: string) {
  const context = contexts(scope, 'display', null, '', rendered.unfound)({ seed }, rendered.variables);
  return (text: string) => evaluate(text, context);
}

// A card's 시작 전 설문 page (Risu's onboarding html) as Risu reads it before a chat begins: its CBS read with the chat's
// start, as a background's is outside any message, its styles taken out for the page's own sheet. Drawn as HTML without
// markdown, as a background is.
export function onboardingPage(scope: ChatScope, html: string): { html: string; css: string } | RanAway {
  try {
    const read = outside(scope, renderChat('display', scope), 'onboarding');
    const cbs = (text: string) => unescapeCbs(read(text));
    const blocks: string[] = [];
    const page = stripStyles(cbs(html), blocks, cbs);
    return { html: page, css: blocks.join('\n') };
  } catch (error) {
    if (error instanceof Runaway) return { kind: 'runaway' };
    throw error;
  }
}

// <risu-style> is a style in Risu's own stored form, the hex of its CSS's UTF-8, which a bot's script may write itself.
// Read as Risu's Buffer reads hex: pair by pair as parseInt reads each, up to the first pair that reads as no number,
// an odd last digit dropped. Its CSS then gets a CBS pass of its own, as in Risu.
function fromHex(hex: string): string {
  const bytes: number[] = [];
  for (let at = 0; at + 1 < hex.length; at += 2) {
    const byte = parseInt(hex.slice(at, at + 2), 16);
    if (Number.isNaN(byte)) break;
    bytes.push(byte);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

// A <style> left open runs to the end of its text, as a browser reads it; bots' backgroundHTML often ends that way.
// One pass, taking what /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi takes: that regex rescans to the end for each
// opener with no > after it, and no opener after that one has a > either.
export function stripStyles(text: string, blocks: string[], cbs: (css: string) => string): string {
  const opener = /<(risu-)?style\b/gi;
  const closers = { plain: /<\/style\s*>/gi, hex: /<\/risu-style\s*>/gi };
  let kept = '';
  let from = 0;
  for (let found = opener.exec(text); found; found = opener.exec(text)) {
    const open = text.indexOf('>', opener.lastIndex);
    if (open === -1) break;
    const closer = found[1] ? closers.hex : closers.plain;
    closer.lastIndex = open + 1;
    const end = closer.exec(text);
    const body = text.slice(open + 1, end ? end.index : text.length);
    blocks.push(found[1] ? cbs(fromHex(body)) : body);
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
  // Before text_join, so an escaped \* is still its own token and not read as a mark. Before story_lines, which splits
  // at the breaks marks leaves soft.
  md.core.ruler.before('text_join', 'story_marks', marks);
  md.core.ruler.after('story_marks', 'story_lines', lines);
  if (html) md.core.ruler.after('story_lines', 'picture_lines', pictureLines);
  else {
    md.inline.ruler.before('html_inline', 'inlay', inlay);
    md.core.ruler.after('story_lines', 'inlay_blocks', inlayBlocks);
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

// Without the bot's HTML, the chat's inlays and text files still show: their markup alone is kept (engine/assets
// OWN_MARKUP).
function inlay(state: StateInline, silent: boolean) {
  OWN_MARKUP.lastIndex = state.pos;
  const found = OWN_MARKUP.exec(state.src);
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

// Preserve tight-list breaks and keep inline-parsed block HTML (e.g. NBSP-indented markup) in one paragraph with <br>.
// Wrapping each line in <p> breaks sibling selectors such as an input's :checked ~ panel rule.
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
// quotes, in the marks Risu gives them, so a bot's CSS for them applies. A mark closed later in its paragraph runs
// across the line breaks before it, which stay inside one paragraph so the mark stays one element. A mark left open
// runs to the end of its line, which is how a reply looks while it streams. A ' followed by a space or the line's end
// opens nothing (the users' book).
function marks(state: StateCore) {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const { closed } = readMarks(state, token.children!);
    token.children = readMarks(state, token.children!, closed).out;
  }
}

// Without `carried`, breaks cut nothing, and it reads which openings close. Dropping the ones that never close at
// their line's end changes no other pairing: a later same mark would have closed them.
function readMarks(state: StateCore, children: Token[], carried?: Set<number>) {
  const out: Token[] = [];
  const open: { mark: Mark; origin: number }[] = [];
  const closed = new Set<number>();
  let opened = 0;
  const tag = (mark: Mark, nesting: 1 | -1) => {
    const { type, tag } = TAGS[mark];
    const token = new state.Token(nesting === 1 ? `${type}_open` : `${type}_close`, tag, nesting);
    if (nesting === 1 && type === 'mark') token.attrSet('risu-mark', QUOTES[mark]!);
    out.push(token);
  };
  const text = (content: string) => content && out.push(Object.assign(new state.Token('text', '', 0), { content }));
  const close = (from: number) => {
    const above = open.splice(from);
    for (const { mark } of above.toReversed()) tag(mark, -1);
    return above;
  };
  const reopen = (marks: typeof open) => {
    for (const entry of marks) {
      open.push(entry);
      tag(entry.mark, 1);
    }
  };
  for (const child of children) {
    if (carried && (child.type === 'softbreak' || child.type === 'hardbreak')) {
      const cut = open.findIndex(({ origin }) => !carried.has(origin));
      const kept = cut === -1 ? [] : close(cut).filter(({ origin }) => carried.has(origin));
      out.push(open.length + kept.length ? new state.Token('hardbreak', 'br', 0) : child);
      reopen(kept);
      continue;
    }
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
      const at = mark === '“' || mark === '‘' ? -1 : open.findLastIndex((entry) => entry.mark === found);
      if (at === -1 && (mark === '”' || mark === '’' || (mark === "'" && !after.trim()))) {
        text(mark);
      } else if (at === -1) {
        open.push({ mark: found, origin: opened++ });
        tag(found, 1);
        if (QUOTES[found]) text(mark);
      } else {
        if (QUOTES[found]) text(mark);
        closed.add(open[at]!.origin);
        // Closing a mark that another opened inside of closes that one too, and opens it again after.
        reopen(close(at).slice(1));
      }
    }
    text(child.content.slice(last));
  }
  close(0);
  return { out, closed };
}
