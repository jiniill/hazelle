import { byParagraph, type Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Drawing, IllustrateFailure } from '../../runtime/tasks/illustrate';

// What a place of a message holds: a scene being drawn or failed comes before its pictures. A run that failed with no
// scene has no paragraph and goes at the message end. pictures: the place's, oldest first.
export type PicturePlace = { paragraph: number | null } & (
  | { kind: 'drawing'; scene: Scene }
  | { kind: 'failed'; failure: IllustrateFailure; version: string; scene: Scene | null }
  | { kind: 'picture'; paragraph: number; pictures: Stored<'illustration'>[] }
);

// pictures: the shown version's, whose text is text.
export function picturePlaces(drawing: Drawing | null, pictures: Stored<'illustration'>[], text: string): PicturePlace[] {
  const places = new Map<number, PicturePlace>();
  for (const [paragraph, place] of byParagraph(pictures, text)) places.set(paragraph, { paragraph, kind: 'picture', pictures: place });
  for (const { scene, failure } of drawing?.sketches ?? []) {
    const { paragraph } = scene;
    places.set(paragraph, failure ? { paragraph, kind: 'failed', failure, version: drawing!.version, scene } : { paragraph, kind: 'drawing', scene });
  }
  const placed = [...places.values()].sort((a, b) => a.paragraph! - b.paragraph!);
  return drawing?.failure ? [...placed, { paragraph: null, kind: 'failed', failure: drawing.failure, version: drawing.version, scene: null }] : placed;
}

// The picture paged to and the place's newest then. A picture made there since shows instead, so a redraw needs no
// reset of its own.
export type Paged = { id: string; newest: string } | null;

export function pagedPicture(pictures: Stored<'illustration'>[], paged: Paged): Stored<'illustration'> {
  const newest = pictures.at(-1)!;
  return (paged?.newest === newest.id && pictures.find(({ id }) => id === paged.id)) || newest;
}
