import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

type Props = { accept: string; multiple?: boolean; icon?: LucideIcon; size?: 'sm' | 'lg'; busy?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; children: ReactNode };

// Omit extension filters on iOS/iPadOS: unknown .charx/.risum/.risup types become unselectable.
// Importer still validates; desktop-reporting iPads are identified by touch points.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Open inside the original press activation; attach input while picking for mobile browsers that require it.
export function pickFiles(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  if (!(IOS && accept.split(',').some((type) => type.trim().startsWith('.')))) input.accept = accept;
  input.multiple = multiple;
  input.hidden = true;
  const done = () => input.remove();
  input.addEventListener('cancel', done);
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    done();
    if (files.length) onFiles(files);
  });
  document.body.append(input);
  input.click();
}

export function FileButton({ accept, multiple = false, icon, size = 'lg', busy = false, disabled = false, onFiles, children }: Props) {
  return (
    <Button variant="secondary" size={size} icon={icon} busy={busy} disabled={disabled} onClick={() => pickFiles(accept, multiple, onFiles)}>
      {children}
    </Button>
  );
}
