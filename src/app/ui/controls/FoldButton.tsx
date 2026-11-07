import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './Button';

// A quiet button beside a row that opens and shuts what hangs under it, saying how many: a chevron turned down while
// open. brief: the count alone, where a row has no room for the words (a sidebar), which stay its name.
export function FoldButton({ open, onToggle, noun, count, brief = false }: { open: boolean; onToggle: () => void; noun: string; count: number; brief?: boolean }) {
  const words = `${noun} ${count}개`;
  return (
    <Button variant="ghost" size="sm" icon={open ? ChevronDown : ChevronRight} expanded={open} label={brief ? words : undefined} onClick={onToggle}>
      {brief ? String(count) : words}
    </Button>
  );
}
