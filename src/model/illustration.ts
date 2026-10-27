import type { ModelRef } from '../connectors/assignment';
import type { PictureRequest } from '../connectors/types';
import type { FileRef } from '../vault/files';
import type { Receipt } from './chat';

// Pictures belong to message versions; never rewrite message text or the bot's assets.

export type Shape = 'portrait' | 'landscape' | 'square';

// Each text field holds Danbooru-style tags, comma separated. x and y: where the figure stands, 0–1 from the top left.
export type Figure = { name: string; look: string; outfit: string; action: string; x: number; y: number };

// paragraph indexes paragraphsOf from zero; setting includes subject-count tags (e.g. 2girls).
export type Scene = { paragraph: number; shape: Shape; setting: string; framing: string; characters: Figure[] };

type Tuning = 'steps' | 'scale' | 'rescale' | 'sampler';

// line anchors placement across text edits; older pictures without it keep their numeric position (user, 2026-10-22).
type Placed = { message: string; version: string; file: FileRef; type: string; size: number; at: number; line?: string };
// receipt is null for a user-edited scene. Older pictures omit generation settings and use model defaults.
// Image calls report no cost.
export type Drawn = Placed & {
  scene: Scene;
  receipt: Receipt | null;
  model: ModelRef;
  sent: Omit<PictureRequest, 'model' | Tuning> & Partial<Pick<PictureRequest, Tuning>>;
};
// Tool pictures have no scene and must never be redrawn. Keep the tool name after module deletion.
export type Attached = Placed & { paragraph: number; width: number; height: number; tool: { module: string; name: string }; caption?: string };
// Told apart by tool, which no drawn picture holds.
export type Illustration = Drawn | Attached;

// Character.ownIllustrate replaces shared switches; runtime/characters illustrateSwitches resolves absent fields.
// auto defaults off because pictures cost credit; spend bypasses consent for pictures not known to be free.
export type IllustrateSwitches = { auto?: boolean; spend?: boolean; prompt?: string; model?: ModelRef; ladder?: Rung[]; pov?: boolean; comic?: boolean };

export type Rung = { from: number; count: number };

// Shared scene/placement paragraph rule: nonempty text lines, not blank-line-separated blocks.
// Tag-only lines (e.g. <GT-SEP/>) provide no visible anchor.
export const isParagraph = (line: string) => line.replace(/<[^>]*>/g, '').trim() !== '';
export const paragraphsOf = (text: string): string[] => text.split('\n').filter(isParagraph).map((line) => line.trim());

// Count visible characters only; markup must not buy extra pictures, nor may pictures outnumber paragraphs.
export function pictureCount(ladder: readonly Rung[], text: string): number {
  const paragraphs = paragraphsOf(text);
  const length = paragraphs.join('').replace(/<[^>]*>/g, '').length;
  return Math.min(ladder.findLast(({ from }) => length >= from)?.count ?? 1, paragraphs.length);
}

// Prefer the saved line nearest its old index, falling back to that index.
// Out-of-range anchors go at the message end without a mark.
export function placeOf(picture: Illustration, text: string): number {
  const paragraph = 'tool' in picture ? picture.paragraph : picture.scene.paragraph;
  if (picture.line === undefined) return paragraph;
  const paragraphs = paragraphsOf(text);
  if (paragraphs[paragraph] === picture.line) return paragraph;
  const found = paragraphs.flatMap((line, index) => (line === picture.line ? [index] : []));
  return found.length ? found.reduce((near, index) => (Math.abs(index - paragraph) < Math.abs(near - paragraph) ? index : near)) : paragraph;
}

// Display-script markers are transient: never store, send, search or copy them.
// Scripts may drop a marker; its picture then falls back to the message end.
const MARK = /\n?(\d+)/g;
export const placeMark = (paragraph: number) => `${paragraph}`;

export function withMarks(text: string, paragraphs: ReadonlySet<number>): string {
  let seen = -1;
  return text
    .split('\n')
    .map((line) => (isParagraph(line) && paragraphs.has(++seen) ? `${line}\n${placeMark(seen)}` : line))
    .join('\n');
}

// Translation uses displayed paragraphs, not stored-text indices: display scripts can reshape lines.
// placed must be that displayed text with its marks.
export function translatedMarks(translation: string, placed: string, keep: ReadonlySet<number>): string {
  const after = new Map<number, number[]>();
  for (const { index, 1: paragraph } of placed.matchAll(MARK)) {
    if (!keep.has(Number(paragraph))) continue;
    const at = paragraphsOf(withoutMarks(placed.slice(0, index))).length - 1;
    after.set(at, [...(after.get(at) ?? []), Number(paragraph)]);
  }
  let seen = -1;
  return translation
    .split('\n')
    .map((line) => (isParagraph(line) && after.has(++seen) ? [line, ...after.get(seen)!.map(placeMark)].join('\n') : line))
    .join('\n');
}

export const withoutMarks = (text: string, keep: ReadonlySet<number> = new Set()) => (text.includes('') ? text.replace(MARK, (whole, paragraph: string) => (keep.has(Number(paragraph)) ? whole : '')) : text);

// Group by paragraph, oldest picture first within each group; text is the current version text.
export function byParagraph<T extends { value: Illustration }>(pictures: readonly T[], text: string): Map<number, T[]> {
  const places = new Map<number, T[]>();
  const placed = pictures.map((picture) => ({ picture, paragraph: placeOf(picture.value, text) }));
  for (const { picture, paragraph } of placed.sort((a, b) => a.paragraph - b.paragraph || a.picture.value.at - b.picture.value.at)) {
    const place = places.get(paragraph);
    if (place) place.push(picture);
    else places.set(paragraph, [picture]);
  }
  return places;
}
