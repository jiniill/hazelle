import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from './Button';

// A quiet button beside a row that opens and shuts what hangs under it (its copies), saying how many: a chevron
// turned down while open.
export function FoldButton({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: string }) {
  return (
    <Button variant="ghost" size="sm" icon={open ? ChevronDown : ChevronRight} expanded={open} onClick={onToggle}>
      {children}
    </Button>
  );
}
