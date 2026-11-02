import { useState, type DragEvent } from 'react';

// Keep card/folder drag types distinct from Files and each other; disable native picture dragging.
// Cards must not enter app-wide file import, nor may folders become filed items.
const CARD = 'application/x-hazelle-card';
const FOLDER = 'application/x-hazelle-folder';
type Carried = 'card' | 'folder';
const TYPES: Record<Carried, string> = { card: CARD, folder: FOLDER };

export const cardDrag = (key: string, carried: Carried = 'card') => ({
  draggable: true,
  onDragStart: (event: DragEvent) => {
    event.dataTransfer.setData(TYPES[carried], key);
    event.dataTransfer.effectAllowed = 'move';
  },
});

type Handlers = { onDragOver?: (event: DragEvent) => void; onDragLeave?: (event: DragEvent) => void; onDrop?: (event: DragEvent) => void };

// Each answers only the type it carries, so one element can take both.
export const bothDrops = (a: Handlers, b: Handlers): Handlers => ({
  onDragOver: (event) => { a.onDragOver?.(event); b.onDragOver?.(event); },
  onDragLeave: (event) => { a.onDragLeave?.(event); b.onDragLeave?.(event); },
  onDrop: (event) => { a.onDrop?.(event); b.onDrop?.(event); },
});

// One rule for both ways a card is placed: a mouse drag here and a held finger (cardOrder).
export const sideOf = (x: number, box: DOMRect): 'before' | 'after' => (x > box.left + box.width / 2 ? 'after' : 'before');

const left = (event: DragEvent) => !event.currentTarget.contains(event.relatedTarget as Node | null);

// over: a card is held above the target.
export function useCardDrop(onDrop: ((key: string) => void) | undefined) {
  const [over, setOver] = useState(false);
  if (!onDrop) return { over: false, props: {} };
  const carries = (event: DragEvent) => event.dataTransfer.types.includes(CARD);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (left(event)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        setOver(false);
        onDrop(event.dataTransfer.getData(CARD));
      },
    } satisfies Handlers,
  };
}

// A card of the carried type held above the target lands beside it, on the side of the half it is over.
export function useCardPlace(onPlace: ((key: string, after: boolean) => void) | undefined, carried: Carried) {
  const [side, setSide] = useState<'before' | 'after' | null>(null);
  if (!onPlace) return { side: null, props: {} };
  const type = TYPES[carried];
  const sideAt = (event: DragEvent) => sideOf(event.clientX, event.currentTarget.getBoundingClientRect());
  return {
    side,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(type)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const next = sideAt(event);
        if (next !== side) setSide(next);
      },
      onDragLeave: (event: DragEvent) => {
        if (left(event)) setSide(null);
      },
      onDrop: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(type)) return;
        event.preventDefault();
        setSide(null);
        onPlace(event.dataTransfer.getData(type), sideAt(event) === 'after');
      },
    } satisfies Handlers,
  };
}
