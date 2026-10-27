import { nearest } from './edit-distance';

// A bot's own picture or video (design §6.4). module: the namespace of the module it came with, null for a module that has none;
// absent for the character's own.
export type BotAsset = { id: string; name: string; type: string; module?: string | null };

export const isVideo = (type: string) => type.startsWith('video/');

// Export-only refs may name illustrations; avatar refs are never accepted in text (PICTURE_REF).
export type PictureKind = 'asset' | 'inlay' | 'illustration' | 'avatar';
export type PictureUrl = (kind: PictureKind, id: string) => string | undefined;

// The chat screen puts the picture's own URL there once it is loaded (resolveAssets), and nothing before.
export const pictureRef = (kind: PictureKind, id: string) => `${kind}:${id}`;
export const assetUrl = (id: string) => pictureRef('asset', id);
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PICTURE_REF = new RegExp(`(asset|inlay|illustration):(${ID})`, 'g');

export const resolveAssets = (text: string, url: PictureUrl) => text.replace(PICTURE_REF, (_, kind: PictureKind, id: string) => url(kind, id) ?? '');

// Keep inlay markup synchronized with cbs/tags, display OWN_MARKUP and Story.tsx attribute readers.
export const inlayMissing = '<span data-inlay-missing></span>';
export const inlayPicture = (id: string) => `<img src="${pictureRef('inlay', id)}"/>`;
export const inlayBlock = (id: string) => `<div class="risu-inlay-image">${inlayPicture(id)}</div>`;
// The type of an inlay holding a Gemini thought signature's item, which is no picture.
export const SIGNATURE = 'signature';
// Resolve inlays after display regex by exact id, never fuzzy asset lookup.
// Signatures never draw; missing items use app-owned placeholders.
const INLAY_TAG = /\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g;

export function inlayIds(texts: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const text of texts) for (const [, , id] of text.matchAll(INLAY_TAG)) ids.add(id!);
  return [...ids];
}

// Composer attachment tags lead text in picture/file order; attachmentLead removes them for translation
// so rewriting text cannot alter attachment references.
export const withAttachments = ({ pictures, files }: { pictures: readonly string[]; files: readonly string[] }, text: string) =>
  [pictures.map((name) => `{{inlay::${name}}}`).join(''), files.map((name) => `{{textfile::${name}}}`).join(''), text].filter(Boolean).join('\n\n');
export function attachmentLead(text: string): { lead: string; text: string } {
  const lead = /^(?:(?:\{\{(?:inlay|textfile)::[^}]+\}\})+(?:\n\n|$))+/.exec(text)?.[0] ?? '';
  return { lead, text: text.slice(lead.length) };
}

const TEXTFILE_TAG = /\{\{textfile::(.+?)\}\}/g;
export const textFileNames = (text: string) => [...new Set([...text.matchAll(TEXTFILE_TAG)].map(([, name]) => name!))];
export const swapTextFiles = (text: string, swap: (name: string) => string) => text.replace(TEXTFILE_TAG, (_, name: string) => swap(name));
// The app's own markup for a text file, drawn after the display regex as inlays are; one the chat lacks has no title,
// which Story.tsx words.
const HTML_TEXT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const placeTextFiles = (text: string, files: readonly { name: string; title: string }[]) =>
  swapTextFiles(text, (name) => `<span data-textfile>${(files.find((file) => file.name === name)?.title ?? '').replace(/[&<>]/g, (char) => HTML_TEXT[char]!)}</span>`);
export const placeInlays = (text: string, inlays: readonly { id: string; name: string; type: string }[]) =>
  text.replace(INLAY_TAG, (_, kind: string, name: string) => {
    const inlay = inlays.find((each) => each.name === name);
    if (!inlay) return inlayMissing;
    if (inlay.type === SIGNATURE) return '';
    return kind === 'inlay' ? inlayPicture(inlay.id) : `${inlayBlock(inlay.id)}\n`;
  });
const pattern = (markup: string) => markup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('@', ID);
// Sticky: it matches only where its lastIndex stands. Group 1: the wrapped picture, a block of its own.
export const OWN_MARKUP = new RegExp(`${pattern(inlayMissing)}|(${pattern(inlayBlock('@'))})|${pattern(inlayPicture('@'))}|<span data-textfile>[^<]*</span>`, 'y');

// Risu's distance for a name that matches none: models write names from {{assetlist}} and often get one slightly wrong.
const NEAR = 4;
const EXTENSIONS = /\.(webp|png|jpe?g|gif|mp4|webm|avi|m4p|m4v|mp3|wav|ogg)$/;
const bare = (name: string) => name.replace(EXTENSIONS, '').trim().replace(/[\s_.-]/g, '');

// As Risu finds one: the name in any case, one of several that share it by the tag's own roll; else the name nearest
// within NEAR edits, its extension and separators aside.
export function findAsset<A extends { name: string }>(assets: readonly A[], name: string, random: () => number): A | null {
  const wanted = name.toLowerCase();
  const same = assets.filter((asset) => asset.name.toLowerCase() === wanted);
  if (same.length) return same[Math.floor(random() * same.length)]!;
  return nearest(bare(wanted), assets, (asset) => bare(asset.name.toLowerCase()), NEAR);
}
