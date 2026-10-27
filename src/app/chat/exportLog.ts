import { pictureRef, resolveAssets, type PictureKind, type PictureUrl } from '../../engine/assets';
import type { Display } from '../../engine/display';
import { shown } from '../../model/chat';
import { byParagraph, placeMark, translatedMarks, withoutMarks } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Shown } from '../../runtime/talk';
import type { OpenChat } from './useChat';
import { inlaid, type LogRow } from '../ui';
import { shownHtml, speaker } from './ChatMessage';
import { seenText } from './search';

export type LogText = 'translation' | 'original' | 'both';
// from, to: message numbers, from 1, both included.
export type LogChoices = { pictures: boolean; hideMe: boolean; text: LogText; from: number; to: number };
// pictures: by pictureRef.
type LogDraft = { rows: LogRow[]; css: string; pictures: Map<string, { kind: PictureKind; id: string }> };

const ME_HIDDEN = '나';

const unlogged = (message: Shown) => message.live !== null || shown(message).receipt?.state === 'failed';

// What a translated log would show untranslated in the range: the messages it holds with a text and no translation.
export const untranslated = (messages: Shown[], view: Display, { from, to }: Pick<LogChoices, 'from' | 'to'>) =>
  messages.slice(from - 1, to).filter((message, offset) => !unlogged(message) && !shown(message).translation && view.texts[from - 1 + offset]!.trim());

// The pictures the chat shows besides its display: by index, the shown text with its 삽화 marks, and by version its 삽화,
// oldest first (useChat).
type Illustrated = { placed: ReadonlyMap<number, string>; pictures: ReadonlyMap<string, Stored<'illustration'>[]> };

// Exclude live/failed/empty replies; restore historical boxes around their message text.
// Use newest illustration at each paragraph, in its first text; order top boxes → story → bottom boxes.
const aroundBoxes = (boxes: Display['boxes'][number], own: string[], decor: { bot: boolean; url: PictureUrl }) => {
  const box = ({ html }: (typeof boxes)[number]) => shownHtml(html, decor);
  return [...boxes.filter(({ at }) => at === 'top').map(box), ...own, ...boxes.filter(({ at }) => at === 'bottom').map(box)];
};

// A message's stories as the display gives them, drawn or not, with no pictures, and the bot's sheet: chat.rendered's.
export function displayed(view: Display, index: number, bot: boolean) {
  const decor = { bot, url: () => undefined };
  const text = view.texts[index]!;
  return { stories: aroundBoxes(view.boxes[index]!, text.trim() ? [shownHtml(text, decor)] : [], decor), css: bot ? resolveAssets(view.css, decor.url) : '' };
}

export function logDraft(messages: Shown[], view: Display, { placed, pictures: drawn }: Illustrated, flipped: ReadonlySet<string>, bot: boolean, names: OpenChat['names'], { hideMe, text, from, to }: LogChoices): LogDraft {
  const decor = { bot, url: pictureRef };
  const rows: LogRow[] = [];
  for (let index = from - 1; index < Math.min(to, messages.length); index++) {
    const message = messages[index]!;
    const version = shown(message);
    if (unlogged(message)) continue;
    const original = view.texts[index]!;
    const translation = version.translation?.text ?? null;
    const own = { text: original, original: true };
    const other = translation === null ? own : { text: translation, original: false };
    const said = (text === 'original' ? [own] : text === 'both' ? [...new Set([own, other])] : [seenText(original, version, null, flipped.has(version.id)) === original ? own : other]).filter((each) => each.text.trim());
    const places = byParagraph(drawn.get(version.id) ?? [], version.text);
    const story = ({ text, original }: (typeof said)[number], at: number) => {
      if (!places.size || at > 0) return shownHtml(text, decor);
      const paragraphs = new Set(places.keys());
      const displayed = placed.get(index) ?? view.texts[index]!;
      const marked = original ? withoutMarks(displayed, paragraphs) : translatedMarks(text, displayed, paragraphs);
      return [...places].reduce((html, [paragraph, pictures]) => inlaid(html, placeMark(paragraph), `<img src="${pictureRef('illustration', pictures.at(-1)!.id)}">`), shownHtml(marked, decor));
    };
    const boxes = view.boxes[index]!;
    if (!said.length && !boxes.length) continue;
    const stories = aroundBoxes(boxes, said.map(story), decor);
    const mine = message.role === 'user';
    rows.push({ key: message.id, name: mine && hideMe ? ME_HIDDEN : speaker(message, names.character, names.me, names.modelName), mine, stories });
  }
  const css = bot ? view.css : '';
  const pictures: LogDraft['pictures'] = new Map();
  const collect = (kind: PictureKind, id: string) => void pictures.set(pictureRef(kind, id), { kind, id });
  for (const source of [css, ...rows.flatMap(({ stories }) => stories)]) resolveAssets(source, collect);
  return { rows, css, pictures };
}

// url: a picture's source; undefined leaves it out.
export const resolveLog = ({ rows, css }: LogDraft, url: PictureUrl) => ({
  rows: rows.map((row) => ({ ...row, stories: row.stories.map((story) => resolveAssets(story, url)) })),
  css: resolveAssets(css, url),
});
