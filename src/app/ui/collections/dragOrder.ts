import { useState, type DragEvent } from 'react';

// at is a gap index (0…count); onMove receives the final item index, not that gap.
export function useDragOrder(onMove: (from: number, to: number) => void, axis: 'x' | 'y') {
  const [drag, setDrag] = useState<{ from: number; at: number } | null>(null);
  return {
    from: drag?.from ?? null,
    at: drag?.at ?? null,
    start: (event: DragEvent, index: number, id: string) => {
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
      setDrag({ from: index, at: index });
    },
    over: (event: DragEvent, index: number) => {
      if (!drag) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      const after = axis === 'y' ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
      const at = after ? index + 1 : index;
      if (at !== drag.at) setDrag({ ...drag, at });
    },
    // On the list itself, so a drop between items lands.
    allow: (event: DragEvent) => drag && event.preventDefault(),
    drop: (event: DragEvent) => {
      if (!drag) return;
      event.preventDefault();
      const to = drag.at > drag.from ? drag.at - 1 : drag.at;
      if (to !== drag.from) onMove(drag.from, to);
      setDrag(null);
    },
    end: () => setDrag(null),
  };
}
