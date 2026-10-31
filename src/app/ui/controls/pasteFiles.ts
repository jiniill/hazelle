import type { ClipboardEvent } from 'react';

// Files pasted with no text; office apps copy a picture of the text beside it, and the text is what was meant.
export function pasteFiles(event: ClipboardEvent<HTMLElement>, onFiles: (files: File[]) => void) {
  const files = [...event.clipboardData.files];
  if (!files.length || event.clipboardData.getData('text/plain')) return;
  event.preventDefault();
  onFiles(files);
}
